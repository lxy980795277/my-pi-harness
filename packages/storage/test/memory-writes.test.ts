import { afterEach, describe, expect, it } from 'vitest';
import { MemoryService } from '@my-pi-harness/memory';
import { openProfileStore } from '../src/index';
import { MEMORY_PROPOSALS_SQL } from '../src/sqlite/migrations/0014-memory-proposals';
import {
  fixture,
  call,
  root,
  entry,
  sql,
  finish,
  event,
  message,
  source,
  cleanupFixtures,
} from './fixtures/memory-writes';

const input = {
  scope: 'user' as const,
  category: 'fact' as const,
  body: 'Independent remembered detail',
};

afterEach(cleanupFixtures);

describe('transactional direct Agent memory writes', () => {
  it('saves immediately and applies the shared mode defaults with host workspace identity', async () => {
    const value = await fixture();
    const saved = entry(value.memory.saveFromAgent(input, call(value, 'save_memory', input)));
    expect(saved).toMatchObject({ mode: 'fixed', enabled: true, source: value.source });
    const learnedInput = { ...input, body: 'Another automatic fact' };
    const learned = entry(
      value.memory.learnFromAgent(learnedInput, call(value, 'learn_memory', learnedInput)),
    );
    expect(learned.mode).toBe('relevant');
    const preference = { ...input, scope: 'workspace' as const, category: 'preference' as const };
    expect(
      entry(value.memory.learnFromAgent(preference, call(value, 'learn_memory', preference))),
    ).toMatchObject({ mode: 'fixed', scope: { kind: 'workspace', workspaceId: 'workspace-a' } });
    expect(
      sql(value, (db) =>
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'memory_proposal%'",
          )
          .all(),
      ),
    ).toEqual([]);
  });

  it('rechecks both automatic learning switches while keeping explicit saves available', async () => {
    const value = await fixture();
    for (const [index, settings] of [
      { allowUse: true, allowLearning: false },
      { allowUse: false, allowLearning: true },
    ].entries()) {
      const access = call(value, 'learn_memory', input);
      value.memory.updateSettings(value.owner, {
        requestId: `off-${index}`,
        expectedRevision: index,
        ...settings,
      });
      expect(() => value.memory.learnFromAgent(input, access)).toThrow('disabled');
      expect(
        value.memory.select(
          value.memory.snapshot({
            ownerUserId: value.owner,
            workspaceId: 'workspace-a',
            includeUser: true,
          }),
          [],
          { query: '', mode: 'fixed' },
        ).policy,
      ).toEqual(settings);
    }
    expect(
      value.memory.saveFromAgent(input, call(value, 'save_memory', input)).entry,
    ).not.toBeNull();
    value.memory.updateSettings(value.owner, {
      requestId: 'on',
      expectedRevision: 2,
      allowUse: true,
      allowLearning: true,
    });
    const learnedInput = { ...input, body: 'Learning after both switches were enabled' };
    expect(
      value.memory.learnFromAgent(learnedInput, call(value, 'learn_memory', learnedInput)).entry,
    ).not.toBeNull();
  });

  it('rejects quoted automatic evidence but permits the explicit save tool', async () => {
    const value = await fixture({ quotes: true });
    expect(() => value.memory.learnFromAgent(input, call(value, 'learn_memory', input))).toThrow(
      'Quoted search material',
    );
    expect(
      value.memory.saveFromAgent(input, call(value, 'save_memory', input)).entry,
    ).not.toBeNull();
  });

  it('checks the actual tool intent, source hash and owner before writing', async () => {
    const value = await fixture();
    const access = call(value, 'save_memory', input);
    expect(() =>
      value.memory.saveFromAgent({ ...input, body: 'Different content' }, access),
    ).toThrow('recorded tool intent');
    expect(() =>
      value.memory.saveFromAgent(input, { ...access, ownerUserId: 'another-owner' }),
    ).toThrow();
    expect(() =>
      value.memory.saveFromAgent(input, {
        ...access,
        source: { ...access.source, contentHash: 'b'.repeat(64) },
      }),
    ).toThrow('changed');
    expect(() => value.memory.learnFromAgent(input, access)).toThrow('no longer executing');
    expect(value.memory.list(value.owner).total).toBe(0);
  });

  it('enforces CAS and current workspace while preserving manual enabled state and update mode', async () => {
    const value = await fixture();
    const saved = entry(
      value.memory.create(value.owner, {
        requestId: 'manual',
        scope: { kind: 'user' },
        category: 'fact',
        body: 'Before',
        enabled: false,
        mode: 'relevant',
      }),
    );
    const update = {
      memoryId: saved.id,
      expectedRevision: 1,
      category: 'instruction' as const,
      body: 'After',
    };
    expect(
      entry(value.memory.updateFromAgent(update, call(value, 'update_memory', update))),
    ).toMatchObject({ revision: 2, mode: 'relevant', enabled: false, source: value.source });
    expect(() =>
      value.memory.updateFromAgent(update, call(value, 'update_memory', update)),
    ).toThrow('revision');
    const foreign = entry(
      value.memory.create(value.owner, {
        requestId: 'foreign',
        scope: { kind: 'workspace', workspaceId: 'workspace-b' },
        category: 'fact',
        body: 'Other project',
        enabled: true,
      }),
    );
    const remove = { memoryId: foreign.id, expectedRevision: 1 };
    expect(() =>
      value.memory.deleteFromAgent(remove, call(value, 'delete_memory', remove)),
    ).toThrow('outside');
    const own = { memoryId: saved.id, expectedRevision: 2 };
    expect(value.memory.deleteFromAgent(own, call(value, 'delete_memory', own)).entry).toBeNull();
  });

  it('requires a selected workspace for workspace saves', async () => {
    const value = await fixture({ workspace: false });
    const workspaceInput = { ...input, scope: 'workspace' as const };
    expect(() =>
      value.memory.saveFromAgent(workspaceInput, call(value, 'save_memory', workspaceInput)),
    ).toThrow('requires the current workspace');
  });

  it('returns the same body-free receipt after completion, forgetting and restart without resurrection', async () => {
    const value = await fixture();
    const access = call(value, 'save_memory', input);
    const first = value.memory.saveFromAgent(input, access);
    expect(value.memory.saveFromAgent(input, access)).toEqual(first);
    expect(() => value.memory.saveFromAgent({ ...input, body: 'Reused identity' }, access)).toThrow(
      'another operation',
    );
    const lateInput = { ...input, body: 'Never committed late write' };
    const lateAccess = call(value, 'save_memory', lateInput);
    finish(value);
    expect(value.memory.saveFromAgent(input, access)).toEqual(first);
    expect(() => value.memory.saveFromAgent(lateInput, lateAccess)).toThrow('active root run');
    value.memory.forget(value.owner, first.receipt.memoryId, {
      requestId: 'manual-forget',
      expectedRevision: 1,
    });
    value.store.close();
    value.store = await openProfileStore(value.directory);
    value.memory = new MemoryService(value.store.memory);
    expect(value.memory.saveFromAgent(input, access)).toEqual({
      receipt: first.receipt,
      entry: null,
    });
    expect(value.memory.list(value.owner).total).toBe(0);
    expect(
      JSON.stringify(
        sql(value, (db) => db.prepare('SELECT data FROM memory_write_receipts').all()),
      ),
    ).not.toContain(input.body);
  });

  it('does not let an older assistant call borrow a later consumed input', async () => {
    const value = await fixture();
    const access = call(value, 'save_memory', input);
    const later = message('later', 'New actual input');
    value.store.append('session', [event('message.started', later)]);
    expect(() => value.memory.saveFromAgent(input, { ...access, source: source(later) })).toThrow(
      'preceded',
    );
    expect(() => value.memory.saveFromAgent(input, access)).toThrow('latest consumed');
  });

  it('suppresses every confirmed source after a later correction and forget', async () => {
    const value = await fixture();
    const saved = entry(value.memory.saveFromAgent(input, call(value, 'save_memory', input)));
    const other = root(value, 'session-b', 'run-b', 'branch-b');
    const update = {
      memoryId: saved.id,
      expectedRevision: 1,
      category: 'fact' as const,
      body: 'Corrected by another current input',
    };
    value.memory.updateFromAgent(update, call(value, 'update_memory', update, other));
    const remove = { memoryId: saved.id, expectedRevision: 2 };
    value.memory.deleteFromAgent(remove, call(value, 'delete_memory', remove, other));
    expect(() => value.memory.saveFromAgent(input, call(value, 'save_memory', input))).toThrow(
      'forgotten',
    );
    expect(
      value.memory.create(value.owner, {
        requestId: 'fresh-manual',
        scope: { kind: 'user' },
        category: 'fact',
        body: input.body,
        enabled: true,
      }).entry,
    ).not.toBeNull();
  });

  it('rejects conflicting manual state and deduplicates only equivalent active facts across sources', async () => {
    const value = await fixture();
    const saved = entry(
      value.memory.create(value.owner, {
        requestId: 'manual-existing',
        scope: { kind: 'user' },
        category: 'fact',
        body: input.body,
        enabled: false,
        mode: 'relevant',
      }),
    );
    expect(() => value.memory.saveFromAgent(input, call(value, 'save_memory', input))).toThrow(
      'disabled or uses a different mode',
    );
    expect(() => value.memory.learnFromAgent(input, call(value, 'learn_memory', input))).toThrow(
      'disabled or uses a different mode',
    );
    expect(value.memory.list(value.owner).items[0]).toEqual(saved);
    const active = entry(
      value.memory.update(value.owner, saved.id, {
        requestId: 'enable-existing',
        expectedRevision: 1,
        category: saved.category,
        body: saved.body,
        mode: 'relevant',
        enabled: true,
      }),
    );
    expect(() => value.memory.saveFromAgent(input, call(value, 'save_memory', input))).toThrow(
      'different mode',
    );
    const equivalent = { ...input, mode: 'relevant' as const };
    const firstAccess = call(value, 'save_memory', equivalent);
    const first = value.memory.saveFromAgent(equivalent, firstAccess);
    const other = root(value, 'session-b', 'run-b', 'branch-b');
    const second = value.memory.saveFromAgent(
      equivalent,
      call(value, 'save_memory', equivalent, other),
    );
    expect(first.entry).toEqual(active);
    expect(second.entry).toEqual(active);
    expect(value.memory.list(value.owner).total).toBe(1);
    expect(second.receipt.requestId).not.toBe(first.receipt.requestId);
    value.memory.forget(value.owner, saved.id, {
      requestId: 'forget-deduplicated',
      expectedRevision: 2,
    });
    expect(value.memory.saveFromAgent(equivalent, firstAccess)).toEqual({
      entry: null,
      receipt: first.receipt,
    });
    expect(() =>
      value.memory.saveFromAgent(equivalent, call(value, 'save_memory', equivalent, other)),
    ).toThrow('forgotten');
    expect(
      value.memory.create(value.owner, {
        requestId: 'new-manual',
        scope: { kind: 'user' },
        category: 'fact',
        body: input.body,
        enabled: true,
      }).entry,
    ).not.toBeNull();
  });

  it('migrates old settings and removes proposal tables without deleting independent memory', async () => {
    const value = await fixture();
    const saved = value.memory.create(value.owner, {
      requestId: 'manual',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'Durable fact',
      enabled: true,
    });
    value.memory.updateSettings(value.owner, {
      requestId: 'old-settings',
      expectedRevision: 0,
      allowUse: false,
      allowLearning: false,
    });
    value.store.close();
    sql(value, (db) => {
      db.exec(
        MEMORY_PROPOSALS_SQL.slice(MEMORY_PROPOSALS_SQL.indexOf('CREATE TABLE memory_proposals')),
      );
      db.prepare(
        "UPDATE memory_settings SET data=json_object('allowUse',json('false'),'allowSuggestions',json('false'),'revision',revision)",
      ).run();
      db.prepare('DELETE FROM schema_migrations WHERE version=16').run();
      db.pragma('user_version=15');
    });
    value.store = await openProfileStore(value.directory);
    value.memory = new MemoryService(value.store.memory);
    expect(value.memory.settings(value.owner)).toEqual({
      allowUse: false,
      allowLearning: true,
      revision: 1,
    });
    expect(value.memory.list(value.owner).items.map((item) => item.id)).toContain(
      saved.receipt.memoryId,
    );
    expect(
      sql(value, (db) =>
        db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'memory_proposal%'").all(),
      ),
    ).toEqual([]);
  });
});
