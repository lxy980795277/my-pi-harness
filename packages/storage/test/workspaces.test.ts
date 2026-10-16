import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Workspace } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index.js';

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
      approvalMode: 'ask',
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
