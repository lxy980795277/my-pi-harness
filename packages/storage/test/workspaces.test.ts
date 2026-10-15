import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Workspace } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index.js';
import { FOUNDATION_SQL } from '../src/migrations/0001-foundation.js';
import { MODEL_SETTINGS_SQL } from '../src/migrations/0002-model-settings.js';
import { WORKSPACES_SQL } from '../src/migrations/0003-workspaces.js';

const owned: { directory: string; store?: ProfileStore }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    item.store?.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});

async function fixture(): Promise<{ directory: string; store: ProfileStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-storage-'));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  owned.push(value);
  return value;
}

function workspace(id = 'workspace'): Workspace {
  return {
    id,
    name: 'Project',
    icon: 'folder',
    rootPath: '/project',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('workspace metadata', () => {
  it('keeps canonical roots unique and revisions explicit across profile reopen', async () => {
    const { directory, store } = await fixture();
    expect(store.createWorkspace(workspace())).toEqual(workspace());
    expect(() => store.createWorkspace(workspace('duplicate'))).toThrow('already exists');
    expect(() =>
      store.renameWorkspace('workspace', { name: 'Changed', expectedRevision: 2 }, 2),
    ).toThrow('revision');
    const renamed = store.renameWorkspace(
      'workspace',
      { name: 'Changed', icon: 'terminal', expectedRevision: 1 },
      2,
    );
    expect(renamed).toMatchObject({
      name: 'Changed',
      icon: 'terminal',
      revision: 2,
      rootPath: '/project',
    });
    const nameOnly = store.renameWorkspace(
      'workspace',
      { name: 'Changed again', expectedRevision: 2 },
      3,
    );
    expect(nameOnly).toMatchObject({ name: 'Changed again', icon: 'terminal', revision: 3 });
    store.close();
    const reopened = await openProfileStore(directory);
    owned.push({ directory, store: reopened });
    expect(reopened.listWorkspaces()).toEqual([nameOnly]);
  });

  it('refuses live session removal and retains archived history when the same root is added again', async () => {
    const { directory, store } = await fixture();
    store.createWorkspace(workspace());
    const session = store.createSession({
      id: 'session',
      branchId: 'branch',
      title: 'Task',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: 'workspace',
      approvalMode: 'read-only',
      at: 2,
    });
    expect(session.workspaceId).toBe('workspace');
    expect(() => store.archiveWorkspace('workspace')).toThrow('sessions');
    expect(() =>
      store.createSession({
        id: 'missing',
        branchId: 'missing-branch',
        title: 'Missing',
        providerId: 'provider',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: 'missing',
        approvalMode: 'ask',
        at: 2,
      }),
    ).toThrow('Workspace does not exist');
    store.append('session', [{ type: 'session.deleted', runId: null, at: 3, data: {} }]);
    store.archiveWorkspace('workspace');
    expect(store.listWorkspaces()).toEqual([]);
    expect(store.getWorkspace('workspace')).toBeUndefined();
    store.createWorkspace(workspace('next'));
    const inspection = new Database(join(directory, 'data.sqlite'), { readonly: true });
    try {
      expect(
        inspection.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get('session'),
      ).toEqual({ workspace_id: 'workspace' });
      expect(inspection.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({
        count: 2,
      });
    } finally {
      inspection.close();
    }
  });
});

describe('released workspace migration', () => {
  it('upgrades v2 projections without rewriting immutable session events or existing IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-migration-'));
    owned.push({ directory });
    const connection = new Database(join(directory, 'data.sqlite'));
    const session = {
      id: 'old-session',
      title: 'Old task',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      createdAt: 1,
      updatedAt: 1,
      activeBranchId: 'old-branch',
      activeRunId: null,
      snapshotSeq: 1,
    };
    const branch = {
      id: 'old-branch',
      sessionId: session.id,
      parentId: null,
      forkMessageId: null,
      createdAt: 1,
    };
    const originalEvent = JSON.stringify({ session, branch });
    try {
      connection.exec(FOUNDATION_SQL);
      connection.exec(MODEL_SETTINGS_SQL);
      connection.exec(
        'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
      );
      for (const [version, sql] of [
        [1, FOUNDATION_SQL],
        [2, MODEL_SETTINGS_SQL],
      ] as const)
        connection
          .prepare('INSERT INTO schema_migrations VALUES (?, ?, 1)')
          .run(version, createHash('sha256').update(sql).digest('hex'));
      connection.pragma('user_version = 2');
      connection
        .prepare('INSERT INTO sessions VALUES (?, 1, NULL, 0, ?)')
        .run(session.id, JSON.stringify(session));
      connection
        .prepare('INSERT INTO branches VALUES (?, ?, ?)')
        .run(branch.id, session.id, JSON.stringify(branch));
      connection
        .prepare('INSERT INTO events VALUES (?, 1, ?, 1, NULL, ?, 1, ?, NULL)')
        .run('old-event', session.id, 'session.created', originalEvent);
    } finally {
      connection.close();
    }
    const store = await openProfileStore(directory);
    owned.push({ directory, store });
    expect(store.getSnapshot(session.id).session).toEqual({
      ...session,
      workspaceId: null,
      approvalMode: 'ask',
    });
    expect(store.readEvents(session.id)[0]?.data).toEqual(JSON.parse(originalEvent));
    const inspection = new Database(join(directory, 'data.sqlite'), { readonly: true });
    try {
      expect(inspection.pragma('user_version', { simple: true })).toBe(4);
      expect(
        inspection.prepare('SELECT data FROM events WHERE event_id = ?').get('old-event'),
      ).toEqual({ data: originalEvent });
      expect(
        inspection.prepare('SELECT checksum FROM schema_migrations WHERE version = 2').get(),
      ).toEqual({ checksum: createHash('sha256').update(MODEL_SETTINGS_SQL).digest('hex') });
    } finally {
      inspection.close();
    }
  });

  it('upgrades v3 workspace icons while preserving archived metadata, revisions and session facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-icon-migration-'));
    owned.push({ directory });
    const connection = new Database(join(directory, 'data.sqlite'));
    const legacyWorkspace = {
      id: 'legacy-workspace',
      name: 'Existing project',
      rootPath: '/legacy/project',
      revision: 7,
      createdAt: 10,
      updatedAt: 20,
    };
    const archivedWorkspace = {
      ...legacyWorkspace,
      id: 'archived-workspace',
      rootPath: '/archived/project',
    };
    const session = {
      id: 'legacy-session',
      title: 'Existing task',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      createdAt: 10,
      updatedAt: 20,
      activeBranchId: 'legacy-branch',
      activeRunId: null,
      snapshotSeq: 1,
      workspaceId: legacyWorkspace.id,
      approvalMode: 'ask',
    };
    const branch = {
      id: session.activeBranchId,
      sessionId: session.id,
      parentId: null,
      forkMessageId: null,
      createdAt: 10,
    };
    const originalEvent = JSON.stringify({ session, branch });
    try {
      connection.exec(
        'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
      );
      for (const [version, sql] of [
        [1, FOUNDATION_SQL],
        [2, MODEL_SETTINGS_SQL],
        [3, WORKSPACES_SQL],
      ] as const) {
        connection.exec(sql);
        connection
          .prepare('INSERT INTO schema_migrations VALUES (?, ?, 1)')
          .run(version, createHash('sha256').update(sql).digest('hex'));
      }
      connection.pragma('user_version = 3');
      connection
        .prepare('INSERT INTO workspaces VALUES (?, ?, 0, ?)')
        .run(legacyWorkspace.id, legacyWorkspace.rootPath, JSON.stringify(legacyWorkspace));
      connection
        .prepare('INSERT INTO workspaces VALUES (?, ?, 1, ?)')
        .run(archivedWorkspace.id, archivedWorkspace.rootPath, JSON.stringify(archivedWorkspace));
      connection
        .prepare('INSERT INTO sessions VALUES (?, 1, NULL, 0, ?, ?)')
        .run(session.id, JSON.stringify(session), legacyWorkspace.id);
      connection
        .prepare('INSERT INTO branches VALUES (?, ?, ?)')
        .run(branch.id, session.id, JSON.stringify(branch));
      connection
        .prepare('INSERT INTO events VALUES (?, 1, ?, 1, NULL, ?, 10, ?, NULL)')
        .run('legacy-event', session.id, 'session.created', originalEvent);
    } finally {
      connection.close();
    }
    const store = await openProfileStore(directory);
    owned.push({ directory, store });
    expect(store.getWorkspace(legacyWorkspace.id)).toEqual({ ...legacyWorkspace, icon: 'folder' });
    expect(store.getSnapshot(session.id).session).toEqual(session);
    const changed = store.renameWorkspace(
      legacyWorkspace.id,
      { name: legacyWorkspace.name, icon: 'rocket', expectedRevision: 7 },
      30,
    );
    expect(changed).toMatchObject({ icon: 'rocket', revision: 8, updatedAt: 30 });
    store.close();
    const reopened = await openProfileStore(directory);
    owned.push({ directory, store: reopened });
    expect(reopened.getWorkspace(legacyWorkspace.id)).toEqual(changed);
    const inspection = new Database(join(directory, 'data.sqlite'), { readonly: true });
    try {
      expect(inspection.pragma('user_version', { simple: true })).toBe(4);
      expect(
        inspection
          .prepare("SELECT json_extract(data, '$.icon') AS icon FROM workspaces WHERE id = ?")
          .get(archivedWorkspace.id),
      ).toEqual({ icon: 'folder' });
      expect(
        inspection.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get(session.id),
      ).toEqual({ workspace_id: legacyWorkspace.id });
      expect(
        inspection.prepare('SELECT data FROM events WHERE event_id = ?').get('legacy-event'),
      ).toEqual({ data: originalEvent });
      expect(
        inspection.prepare('SELECT checksum FROM schema_migrations WHERE version = 3').get(),
      ).toEqual({ checksum: createHash('sha256').update(WORKSPACES_SQL).digest('hex') });
    } finally {
      inspection.close();
    }
  });
});
