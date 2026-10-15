import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openProfileStore } from '../src/index.js';
import { FOUNDATION_SQL } from '../src/migrations/0001-foundation.js';

describe('released model settings migration', () => {
  it('upgrades real v1 rows, binds an unmodified enabled native entry deterministically and preserves frozen facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-model-migration-'));
    const sqlite = new Database(join(directory, 'data.sqlite'));
    try {
      sqlite.exec(FOUNDATION_SQL);
      sqlite.exec(
        'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
      );
      sqlite
        .prepare('INSERT INTO schema_migrations VALUES (1, ?, 1)')
        .run(createHash('sha256').update(FOUNDATION_SQL).digest('hex'));
      sqlite.pragma('user_version = 1');
      const original: string[] = [];
      for (const [id, enabled, baseUrl] of [
        ['native-z', false, null],
        ['native-b', true, null],
        ['native-a', true, null],
        ['native-0-proxy', true, 'https://proxy.invalid/v1'],
        ['native-0-model', true, null],
      ] as const) {
        const models =
          id === 'native-0-model'
            ? [
                {
                  id: 'legacy-model',
                  name: 'Custom limits',
                  api: 'openai-completions',
                  contextWindow: 4096,
                  maxTokens: 512,
                  reasoning: false,
                  input: ['text'],
                },
              ]
            : [];
        const data = JSON.stringify({
          id,
          name: id,
          kind: 'builtin',
          builtinId: 'openai',
          api: null,
          baseUrl,
          models,
          enabled,
          credentialRef: `credential-${id}`,
          revision: 1,
          hasCredential: false,
          credentialType: null,
        });
        original.push(data);
        sqlite.prepare('INSERT INTO provider_configs VALUES (?, 1, ?)').run(id, data);
        sqlite.prepare('INSERT INTO provider_versions VALUES (?, 1, ?)').run(id, data);
      }
      const session = {
        id: 'legacy-session',
        title: 'Legacy',
        providerId: 'native-b',
        modelId: 'legacy-model',
        thinkingLevel: 'off',
        createdAt: 1,
        updatedAt: 1,
        activeBranchId: 'legacy-branch',
        activeRunId: null,
        snapshotSeq: 1,
      };
      const branch = {
        id: 'legacy-branch',
        sessionId: session.id,
        parentId: null,
        forkMessageId: null,
        createdAt: 1,
      };
      const data = JSON.stringify({ session, branch });
      sqlite
        .prepare('INSERT INTO sessions VALUES (?, 1, NULL, 0, ?)')
        .run(session.id, JSON.stringify(session));
      sqlite
        .prepare('INSERT INTO branches VALUES (?, ?, ?)')
        .run(branch.id, session.id, JSON.stringify(branch));
      sqlite
        .prepare('INSERT INTO events VALUES (?, 1, ?, 1, NULL, ?, 1, ?, NULL)')
        .run('legacy-event', session.id, 'session.created', data);
      sqlite.close();
      const store = await openProfileStore(directory);
      try {
        expect(store.getBuiltinProviderId('openai')).toBe('native-a');
        expect(store.listProviders()).toHaveLength(5);
        for (const config of store.listProviders())
          expect(config).toMatchObject({
            requiresApiKey: true,
            credentialRef: `credential-${config.id}`,
            revision: 1,
          });
        expect(store.getSnapshot(session.id).session).toEqual({
          ...session,
          workspaceId: null,
          approvalMode: 'ask',
        });
        expect(store.getSettings()).toEqual({ revision: 1, defaultModel: null });
        store.putSettings({
          expectedRevision: 1,
          defaultModel: { providerId: 'native-a', modelId: 'model', thinkingLevel: 'off' },
        });
        expect(() => store.putSettings({ expectedRevision: 1, defaultModel: null })).toThrow(
          'revision',
        );
      } finally {
        store.close();
      }
      const inspection = new Database(join(directory, 'data.sqlite'));
      try {
        expect(inspection.pragma('user_version', { simple: true })).toBe(4);
        expect(
          inspection.prepare('SELECT data FROM provider_versions ORDER BY rowid').all(),
        ).toEqual(original.map((value) => ({ data: value })));
        expect(inspection.prepare('SELECT data FROM events').get()).toEqual({ data });
        expect(
          inspection.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get(),
        ).toEqual({ checksum: createHash('sha256').update(FOUNDATION_SQL).digest('hex') });
      } finally {
        inspection.close();
      }
      const reopened = await openProfileStore(directory);
      try {
        expect(reopened.getBuiltinProviderId('openai')).toBe('native-a');
        expect(reopened.getSettings().defaultModel?.providerId).toBe('native-a');
      } finally {
        reopened.close();
      }
    } finally {
      if (sqlite.open) sqlite.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
