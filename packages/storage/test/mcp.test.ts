import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openProfileStore,
  type ProfileStore,
  type StoredMcpServer,
  type McpStartupGrant,
} from '../src/index.js';

const fixtures: { directory: string; store: ProfileStore }[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-mcp-store-'));
  const value = { directory, store: await openProfileStore(directory) };
  fixtures.push(value);
  return value;
}
function server(): StoredMcpServer {
  return {
    id: 'server',
    name: 'Fixture',
    workspaceId: 'workspace',
    command: '/usr/bin/fixture',
    args: ['server'],
    publicEnvironment: {},
    secretSlots: [{ slotId: 'api', environmentName: 'API_KEY' }],
    secretBindings: [
      { slotId: 'api', environmentName: 'API_KEY', credentialRef: null, credentialEpoch: 1 },
    ],
    revision: 1,
    enabled: false,
    accessEpoch: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}
function grant(serverRevision = 1): McpStartupGrant {
  return {
    id: 'grant',
    serverId: 'server',
    serverRevision,
    accessEpoch: 1,
    scope: 'sandboxed',
    ownerId: 'owner',
    identityEpoch: 1,
    workspaceId: 'workspace',
    workspaceRoot: '/project',
    startupFingerprint: 'a'.repeat(64),
    grantedAt: 2,
  };
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('authoritative MCP configuration and grants', () => {
  it('persists settings, secret references and per-scope grants across projection rebuilds', async () => {
    const value = await fixture();
    const saved = value.store.mcp.save(server(), null);
    expect(saved.enabled).toBe(false);
    value.store.mcp.trust(grant());
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.mcp.list()).toHaveLength(1);
    expect(value.store.mcp.get('server')?.enabled).toBe(true);
    expect(value.store.mcp.grant('server', 'sandboxed')?.id).toBe('grant');
    expect(value.store.mcp.grant('server', 'full-access')).toBeUndefined();
  });
  it('rejects stale revisions and invalidates startup grants on configuration changes', async () => {
    const { store } = await fixture();
    store.mcp.save(server(), null);
    store.mcp.trust(grant());
    expect(() => store.mcp.save(server(), null)).toThrow();
    expect(() => store.mcp.save({ ...server(), revision: 2 }, 9)).toThrow();
    store.mcp.save({ ...server(), name: 'Changed', revision: 2, updatedAt: 3 }, 1);
    expect(store.mcp.grants('server')).toEqual([]);
    expect(() => store.mcp.trust(grant())).toThrow();
  });
  it('does not allow a control update to mutate command or bypass startup trust', async () => {
    const { store } = await fixture();
    store.mcp.save(server(), null);
    expect(() => store.mcp.save({ ...server(), command: '/other', accessEpoch: 2 }, 1, 1)).toThrow(
      'Control updates',
    );
    expect(() => store.mcp.save({ ...server(), enabled: true, accessEpoch: 2 }, 1, 1)).toThrow(
      'Control updates',
    );
    expect(store.mcp.get('server')?.accessEpoch).toBe(1);
  });
  it('makes explicit disable and credential revocation irreversible for old grants', async () => {
    const { store } = await fixture();
    store.mcp.save(server(), null);
    store.mcp.trust(grant());
    store.mcp.save({ ...server(), accessEpoch: 2, updatedAt: 3 }, 1, 1);
    expect(() => store.mcp.trust(grant())).toThrow();
    expect(() => store.mcp.save({ ...server(), accessEpoch: 3 }, 1, 1)).toThrow();
    const next = { ...server(), revision: 2, accessEpoch: 3, updatedAt: 4 };
    expect(store.mcp.save(next, 1, 2)).toMatchObject({
      revision: 2,
      accessEpoch: 3,
      enabled: false,
    });
  });
  it('keeps identity revocation independent from browser sessions and rejects an old identity grant', async () => {
    const { store } = await fixture();
    store.mcp.save(server(), null);
    store.mcp.trust(grant());
    expect(store.mcp.identity('owner').epoch).toBe(1);
    expect(store.mcp.revokeIdentity('owner').epoch).toBe(2);
    expect(store.mcp.grants('server')).toEqual([]);
    expect(() => store.mcp.trust(grant())).toThrow();
    expect(() => store.mcp.identity('another-owner')).toThrow();
  });
  it('deletes configuration and grant atomically and never invents a missing revision', async () => {
    const { store } = await fixture();
    store.mcp.save(server(), null);
    store.mcp.trust(grant());
    expect(() => store.mcp.remove('server', 9)).toThrow();
    expect(store.mcp.grants('server')).toHaveLength(1);
    store.mcp.remove('server', 1);
    expect(store.mcp.get('server')).toBeUndefined();
    expect(store.mcp.grants('server')).toEqual([]);
  });
  it('validates durable records before returning them', async () => {
    const value = await fixture();
    value.store.mcp.save(server(), null);
    const db = new Database(join(value.directory, 'data.sqlite'));
    try {
      db.prepare('UPDATE mcp_servers SET data = ? WHERE id = ?').run('{"id":"server"}', 'server');
    } finally {
      db.close();
    }
    expect(() => value.store.mcp.get('server')).toThrow();
  });
});
