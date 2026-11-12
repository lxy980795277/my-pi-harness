import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService } from '@my-pi-harness/memory';
import type { MemoryCreateInput, MemoryEntry, MemoryScope } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index';

interface Fixture {
  directory: string;
  store: ProfileStore;
  owner: string;
  memory: MemoryService;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-memory-'));
  const store = await openProfileStore(directory);
  store.auth.createLocalClient({
    id: 'client',
    tokenHash: hash('test-client-token'),
    csrfToken: 'test-csrf',
    createdAt: 1,
    expiresAt: 100,
  });
  const login = store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'memory-test-owner',
      name: 'Memory test',
      avatarUrl: null,
    },
    'client',
    { id: 'login', tokenHash: hash('test-login-token'), createdAt: 2, expiresAt: 99 },
  );
  let nextId = 0;
  const value = {
    directory,
    store,
    owner: login.user.id,
    memory: new MemoryService(store.memory, {
      now: () => 10,
      createId: () => `memory-${++nextId}`,
    }),
  };
  fixtures.push(value);
  return value;
}

function create(
  value: Fixture,
  requestId: string,
  scope: MemoryScope = { kind: 'user' },
): MemoryEntry {
  const result = value.memory.create(value.owner, {
    requestId,
    scope,
    category: 'preference',
    body: `  Remember ${requestId}\r\n  `,
    enabled: true,
  });
  if (!result.entry) throw new Error('Expected a surviving memory');
  return result.entry;
}

function workspace(value: Fixture, id: string): void {
  value.store.createWorkspace({
    id,
    name: id,
    icon: 'folder',
    rootPath: `/tmp/memory-${id}`,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
}

function input(requestId: string): MemoryCreateInput {
  return {
    requestId,
    scope: { kind: 'user' },
    category: 'fact',
    body: 'An independent fact',
    enabled: true,
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function inspect<T>(value: Fixture, read: (database: Database.Database) => T): T {
  const database = new Database(join(value.directory, 'data.sqlite'), { readonly: true });
  try {
    return read(database);
  } finally {
    database.close();
  }
}

describe('independent confirmed memories', () => {
  it('pages hundreds of relevant facts while fixed bodies and exact current statuses remain bounded', async () => {
    const value = await fixture();
    const fixed = create(value, 'fixed');
    const ids: string[] = [];
    for (let index = 0; index < 240; index += 1) {
      const saved = value.memory.create(value.owner, {
        ...input(`relevant-${index}`),
        mode: 'relevant',
        body: `Relevant source body ${index}`,
      });
      ids.push(saved.receipt.memoryId);
    }
    const access = { ownerUserId: value.owner, workspaceId: null, includeUser: true };
    const captured = value.memory.snapshot(access);
    expect(captured.fixed.map((entry) => entry.id)).toEqual([fixed.id]);
    expect(captured.candidates).toHaveLength(241);
    expect(JSON.stringify(captured.candidates)).not.toContain('Relevant source body');
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = value.memory.list(value.owner, {
        mode: 'relevant',
        limit: 37,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.total).toBe(240);
      expect(page.items.length).toBeLessThanOrEqual(37);
      seen.push(...page.items.map((entry) => entry.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(new Set(seen).size).toBe(240);
    const first = ids[0];
    const last = ids.at(-1);
    if (!first || !last) throw new Error('missing relevant ids');
    expect(value.memory.entries(access, [first, last])).toHaveLength(2);
    expect(value.memory.statuses(value.owner, [last, 'forgotten'])).toMatchObject([
      { id: last, revision: 1, mode: 'relevant', enabled: true },
      { id: 'forgotten', revision: null, mode: null, enabled: false },
    ]);
    value.memory.create(value.owner, { ...input('new-unmatched'), mode: 'relevant' });
    expect(value.memory.isCurrent(access, captured.fingerprint)).toBe(false);
    const beforeChange = value.memory.snapshot(access);
    value.memory.update(value.owner, last, {
      requestId: 'change-unmatched',
      expectedRevision: 1,
      category: 'fact',
      body: 'Updated unmatched body',
      enabled: false,
    });
    expect(value.memory.isCurrent(access, beforeChange.fingerprint)).toBe(false);
    value.memory.updateSettings(value.owner, {
      requestId: 'stop-memory',
      expectedRevision: 0,
      allowUse: false,
      allowLearning: false,
    });
    expect(value.memory.snapshot(access).fixed).toEqual([]);
    expect(value.memory.statuses(value.owner, [last])[0]?.mode).toBe('relevant');
  });

  it('limits child user facts to exact granted IDs in metadata, entry reads and both search engines', async () => {
    const value = await fixture();
    workspace(value, 'a');
    workspace(value, 'b');
    const user = create(value, 'user-fixed');
    const granted = value.memory.create(value.owner, {
      ...input('granted-user'),
      mode: 'relevant',
      body: 'Shared granted user fact',
    });
    const forbidden = value.memory.create(value.owner, {
      ...input('forbidden-user'),
      mode: 'relevant',
      body: 'Shared forbidden user fact',
    });
    const project = value.memory.create(value.owner, {
      ...input('project-related'),
      mode: 'relevant',
      scope: { kind: 'workspace', workspaceId: 'a' },
      body: 'Shared project fact',
    });
    create(value, 'project-fixed', { kind: 'workspace', workspaceId: 'a' });
    create(value, 'other-fixed', { kind: 'workspace', workspaceId: 'b' });
    const child = {
      ownerUserId: value.owner,
      workspaceId: 'a',
      includeUser: false,
      userMemoryIds: [granted.receipt.memoryId],
    };
    expect(value.memory.snapshot(child).candidates.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([granted.receipt.memoryId, project.receipt.memoryId]),
    );
    expect(
      value.memory
        .snapshot(child)
        .candidates.some(
          (entry) => entry.id === forbidden.receipt.memoryId || entry.id === user.id,
        ),
    ).toBe(false);
    expect(
      value.memory
        .entries(child, [
          granted.receipt.memoryId,
          forbidden.receipt.memoryId,
          project.receipt.memoryId,
        ])
        .map((entry) => entry.id),
    ).toEqual(expect.arrayContaining([granted.receipt.memoryId, project.receipt.memoryId]));
    const page = value.store.search.sources({ limit: 16 });
    for (const source of page.items) {
      value.store.search.replaceChunks({
        generation: 1,
        source: source.source,
        signature: 'grant-v1',
        chunks: [
          { ordinal: 0, start: 0, end: source.text.length, text: source.text, tokens: source.text },
        ],
      });
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature: 'grant-v1',
        modelSignature: 'model',
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [1, 0] }],
      });
    }
    const searchAccess = {
      ownerUserId: value.owner,
      scope: {
        kind: 'memory' as const,
        memoryMode: 'relevant' as const,
        workspaceId: 'a',
        includeUserMemories: false,
      },
      userMemoryIds: child.userMemoryIds,
    };
    expect(
      value.store.search
        .lexical(searchAccess, { tokens: ['Shared'] })
        .map((entry) => entry.source.id),
    ).toEqual(
      expect.arrayContaining([
        `memory:${granted.receipt.memoryId}`,
        `memory:${project.receipt.memoryId}`,
      ]),
    );
    expect(value.store.search.lexical(searchAccess, { tokens: ['Shared'] })).toHaveLength(2);
    const vectors = value.store.search.vectors(searchAccess, { modelSignature: 'model' });
    expect(vectors.items.map((entry) => entry.source.id).sort()).toEqual(
      [`memory:${granted.receipt.memoryId}`, `memory:${project.receipt.memoryId}`].sort(),
    );
    expect(vectors.next).toBeNull();
    const before = value.memory.snapshot(child);
    value.memory.forget(value.owner, granted.receipt.memoryId, {
      requestId: 'forget-granted',
      expectedRevision: 1,
    });
    expect(value.memory.isCurrent(child, before.fingerprint)).toBe(false);
    expect(value.memory.entries(child, [granted.receipt.memoryId])).toEqual([]);
    expect(value.store.search.vectors(searchAccess, { modelSignature: 'model' })).toMatchObject({
      items: [{ source: { id: `memory:${project.receipt.memoryId}` } }],
      next: null,
    });
  });

  it('keeps defaults unpersisted and survives edits, restart and session projection rebuilding', async () => {
    const value = await fixture();
    expect(value.memory.settings(value.owner)).toEqual({
      allowUse: true,
      allowLearning: true,
      revision: 0,
    });
    expect(
      inspect(value, (db) => db.prepare('SELECT COUNT(*) AS count FROM memory_settings').get()),
    ).toEqual({ count: 0 });
    const entry = create(value, 'create');
    expect(entry.body).toBe('Remember create');
    const changed = value.memory.update(value.owner, entry.id, {
      requestId: 'edit',
      expectedRevision: 1,
      category: 'instruction',
      body: 'Use concise Chinese',
      enabled: false,
    });
    expect(changed.entry).toMatchObject({ revision: 2, enabled: false });
    value.memory.updateSettings(value.owner, {
      requestId: 'settings',
      expectedRevision: 0,
      allowUse: false,
      allowLearning: false,
    });
    value.store.close();
    value.store = await openProfileStore(value.directory);
    value.memory = new MemoryService(value.store.memory);
    expect(value.memory.list(value.owner).items).toEqual([changed.entry]);
    expect(value.memory.settings(value.owner)).toEqual({
      allowUse: false,
      allowLearning: false,
      revision: 1,
    });
  });

  it('enforces CAS and shared request identities without retrying a forgotten write', async () => {
    const value = await fixture();
    const original = value.memory.create(value.owner, input('same-request'));
    expect(value.memory.create(value.owner, input('same-request'))).toEqual(original);
    expect(value.memory.list(value.owner).items).toHaveLength(1);
    expect(() =>
      value.memory.create(value.owner, { ...input('same-request'), body: 'different' }),
    ).toThrow('identity');
    const id = original.receipt.memoryId;
    expect(() =>
      value.memory.update(value.owner, id, {
        requestId: 'bad-cas',
        expectedRevision: 2,
        category: 'fact',
        body: 'wrong',
        enabled: true,
      }),
    ).toThrow('revision');
    const forgotten = value.memory.forget(value.owner, id, {
      requestId: 'forget',
      expectedRevision: 1,
    });
    expect(forgotten).toMatchObject({ entry: null, receipt: { status: 'forgotten', revision: 2 } });
    expect(
      value.memory.forget(value.owner, id, { requestId: 'forget', expectedRevision: 1 }),
    ).toEqual(forgotten);
    expect(value.memory.create(value.owner, input('same-request'))).toEqual({
      ...original,
      entry: null,
    });
    expect(value.memory.list(value.owner).items).toEqual([]);
    const retained = inspect(value, (db) => ({
      receipts: JSON.stringify(db.prepare('SELECT * FROM memory_write_receipts').all()),
      suppressions: JSON.stringify(db.prepare('SELECT * FROM memory_suppressions').all()),
    }));
    expect(retained.receipts).not.toContain('independent fact');
    expect(retained.suppressions).not.toContain('independent fact');
    expect(value.memory.create(value.owner, input('new-human-save')).entry).not.toBeNull();
  });

  it('scopes before selection and invalidates snapshots on additions, disable, forget and settings changes', async () => {
    const value = await fixture();
    workspace(value, 'a');
    workspace(value, 'b');
    const user = create(value, 'user');
    const a = create(value, 'a', { kind: 'workspace', workspaceId: 'a' });
    create(value, 'b', { kind: 'workspace', workspaceId: 'b' });
    const root = { ownerUserId: value.owner, workspaceId: 'a', includeUser: true };
    const child = { ...root, includeUser: false };
    expect(value.memory.snapshot(root).fixed.map((entry) => entry.id)).toEqual([user.id, a.id]);
    expect(value.memory.snapshot(child).fixed.map((entry) => entry.id)).toEqual([a.id]);
    expect(value.memory.snapshot({ ...child, workspaceId: null }).fixed).toEqual([]);
    const before = value.memory.snapshot(root);
    create(value, 'new-a', { kind: 'workspace', workspaceId: 'a' });
    expect(value.memory.isCurrent(root, before.fingerprint)).toBe(false);
    const afterAdd = value.memory.snapshot(root);
    value.memory.update(value.owner, a.id, {
      requestId: 'disable',
      expectedRevision: 1,
      body: a.body,
      category: a.category,
      enabled: false,
    });
    expect(value.memory.isCurrent(root, afterAdd.fingerprint)).toBe(false);
    expect(value.memory.snapshot(root).fixed.some((entry) => entry.id === a.id)).toBe(false);
    const beforeForget = value.memory.snapshot(root);
    value.memory.forget(value.owner, user.id, { requestId: 'forget-user', expectedRevision: 1 });
    expect(value.memory.isCurrent(root, beforeForget.fingerprint)).toBe(false);
    value.memory.updateSettings(value.owner, {
      requestId: 'disable-use',
      expectedRevision: 0,
      allowUse: false,
      allowLearning: false,
    });
    expect(value.memory.snapshot(root).fixed).toEqual([]);
    const disabled = value.memory.snapshot(root);
    value.memory.updateSettings(value.owner, {
      requestId: 'enable-use',
      expectedRevision: 1,
      allowUse: true,
      allowLearning: false,
    });
    expect(value.memory.isCurrent(root, disabled.fingerprint)).toBe(false);
  });

  it('refuses owner and unknown workspace access, without counting another scope as a visible result', async () => {
    const value = await fixture();
    create(value, 'private');
    expect(() => value.memory.list('other-owner')).toThrow('profile owner');
    expect(() =>
      value.memory.create(value.owner, {
        ...input('missing'),
        scope: { kind: 'workspace', workspaceId: 'missing' },
      }),
    ).toThrow('workspace');
    expect(() =>
      value.memory.snapshot({ ownerUserId: 'other-owner', workspaceId: null, includeUser: true }),
    ).toThrow('profile owner');
    expect(
      value.memory.list(value.owner, { scope: { kind: 'workspace', workspaceId: 'another' } })
        .items,
    ).toEqual([]);
  });

  it('rechecks exact root source in the write transaction but allows independent correction after archival', async () => {
    const value = await fixture();
    value.store.createSession({
      id: 'source-session',
      branchId: 'source-branch',
      title: 'Source',
      providerId: 'p',
      modelId: 'm',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 1,
    });
    value.store.append('source-session', [
      {
        type: 'message.started',
        runId: null,
        at: 2,
        data: {
          id: 'source-message',
          sessionId: 'source-session',
          branchId: 'source-branch',
          runId: null,
          role: 'user',
          text: 'Original quoted preference 😀',
          thinking: '',
          createdAt: 2,
          status: 'complete',
          stopReason: null,
        },
      },
    ]);
    const source = {
      kind: 'message' as const,
      sessionId: 'source-session',
      branchId: 'source-branch',
      messageId: 'source-message',
      contentHash: hash('Original quoted preference 😀'),
    };
    expect(() =>
      value.memory.create(value.owner, {
        ...input('bad-source'),
        source: { ...source, contentHash: '0'.repeat(64) },
      }),
    ).toThrow('source');
    const saved = value.memory.create(value.owner, { ...input('source'), source });
    expect(saved.entry?.source).toEqual(source);
    value.store.append('source-session', [
      { type: 'session.deleted', runId: null, at: 3, data: {} },
    ]);
    expect(() => value.memory.create(value.owner, { ...input('after-archive'), source })).toThrow(
      'source',
    );
    const edited = value.memory.update(value.owner, saved.receipt.memoryId, {
      requestId: 'edit-independent',
      expectedRevision: 1,
      category: 'fact',
      body: 'Corrected independently',
      enabled: true,
    });
    expect(edited.entry?.revision).toBe(2);
    expect(
      value.memory.forget(value.owner, saved.receipt.memoryId, {
        requestId: 'forget-independent',
        expectedRevision: 2,
      }).entry,
    ).toBeNull();
  });

  it('retains a body-free settings receipt and rejects stale settings CAS', async () => {
    const value = await fixture();
    const input = {
      requestId: 'settings',
      expectedRevision: 0,
      allowUse: true,
      allowLearning: false,
    };
    const saved = value.memory.updateSettings(value.owner, input);
    expect(value.memory.updateSettings(value.owner, input)).toEqual(saved);
    expect(() =>
      value.memory.updateSettings(value.owner, { ...input, requestId: 'stale' }),
    ).toThrow('revision');
    expect(() => value.memory.updateSettings(value.owner, { ...input, allowUse: false })).toThrow(
      'identity',
    );
  });

  it('rejects the 101st fact without hiding any of the first hundred from management or recall', async () => {
    const value = await fixture();
    for (let index = 0; index < 100; index += 1) create(value, `create-${index}`);
    expect(() => create(value, 'overflow')).toThrow('At most 100');
    expect(value.memory.list(value.owner, { limit: 100 }).items).toHaveLength(100);
    expect(
      value.memory.snapshot({ ownerUserId: value.owner, workspaceId: null, includeUser: true })
        .fixed,
    ).toHaveLength(100);
  });
});
