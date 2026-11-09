import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RemoteMcpManager, decodeMcpCatalog } from '@my-pi-harness/integrations';
import { createMemoryCredentialStore, openProfileStore } from '@my-pi-harness/storage';
import { remoteFixture } from '../../../tests/fixtures/remote-mcp';
import { RemoteMcpService } from '../src/mcp/remote-service';
import { McpService } from '../src/mcp/service';
import { mcpManagerFixture } from './support/mcp';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function profile() {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-catalog-lifecycle-'));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const store = await openProfileStore(directory);
  cleanups.push(() => {
    store.close();
    return Promise.resolve();
  });
  const now = Date.now();
  store.auth.createLocalClient({
    id: 'local',
    tokenHash: 'a'.repeat(64),
    csrfToken: 'fixture',
    createdAt: now,
    expiresAt: now + 60_000,
  });
  store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'fixture',
      name: 'Fixture',
      avatarUrl: null,
    },
    'local',
    { id: 'login', tokenHash: 'b'.repeat(64), createdAt: now, expiresAt: now + 60_000 },
  );
  return { directory, store };
}
async function setup() {
  const p = await profile();
  const manager = new RemoteMcpManager();
  const remote = new RemoteMcpService({
    store: p.store,
    repository: p.store.remoteMcp,
    credentials: createMemoryCredentialStore(),
    manager,
  });
  cleanups.push(async () => await remote.close());
  const server = remote.create({
    name: 'GitHub fixture',
    transport: 'streamable-http',
    endpoint: 'https://fixture.example/mcp',
    publicHeaders: {},
    secretHeaders: [],
    oauth: false,
  });
  const preview = remote.preview(server.id, {
    expectedRevision: server.revision,
    expectedAccessEpoch: server.accessEpoch,
  });
  remote.trust(server.id, {
    expectedRevision: server.revision,
    expectedAccessEpoch: server.accessEpoch,
    fingerprint: preview.fingerprint,
  });
  return { ...p, manager, remote, server };
}
function catalog() {
  return decodeMcpCatalog(
    JSON.stringify({
      tools: [
        {
          name: 'read_repository',
          description: 'Read repository',
          inputSchema: {
            type: 'object',
            properties: { owner: { type: 'string' } },
            required: ['owner'],
            additionalProperties: false,
          },
        },
      ],
      resources: [],
      prompts: [],
    }),
  );
}
function gate() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('restores a real SDK catalog after profile restart without a new handshake or a GET side effect', async () => {
  const upstream = await remoteFixture('streamable-http');
  cleanups.push(async () => await upstream.close());
  const { store, directory } = await profile();
  const first = new RemoteMcpService({
    store,
    repository: store.remoteMcp,
    credentials: createMemoryCredentialStore(),
    fixtureOrigin: upstream.origin,
  });
  cleanups.push(async () => await first.close());
  const server = first.create({
    name: 'Persisted fixture',
    transport: 'streamable-http',
    endpoint: upstream.endpoint,
    publicHeaders: {},
    secretHeaders: [],
    oauth: false,
  });
  const control = { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch };
  first.trust(server.id, {
    ...control,
    fingerprint: first.preview(server.id, control).fingerprint,
  });
  expect(first.list()[0]?.catalogStatus).toBe('idle');
  expect(first.catalog(server.id)).toBeNull();
  expect(upstream.requests()).toBe(0);
  const before = await first.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  expect(before).toHaveLength(1);
  expect(before[0]?.displayName).toBe('Persisted fixture / echo');
  expect(store.mcp.directory.catalog(server.id, 'remote')).toBeDefined();
  await first.close();
  store.close();
  const reopened = await openProfileStore(directory);
  cleanups.push(() => {
    reopened.close();
    return Promise.resolve();
  });
  const second = new RemoteMcpService({
    store: reopened,
    repository: reopened.remoteMcp,
    credentials: createMemoryCredentialStore(),
    fixtureOrigin: upstream.origin,
  });
  cleanups.push(async () => await second.close());
  const requests = upstream.requests();
  second.initializeCatalogs();
  const after = await second.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  expect(after.map((tool) => tool.definition)).toEqual(before.map((tool) => tool.definition));
  expect(second.metadata(server.id)?.resources).toHaveLength(1);
  expect(second.get(server.id).catalogStatus).toBe('ready');
  expect(upstream.requests()).toBe(requests);
  expect(upstream.calls()).toBe(0);
});

it('joins startup preparation and simultaneous Runs instead of freezing an empty catalog', async () => {
  const f = await setup();
  const entered = gate();
  const finish = gate();
  const value = catalog();
  const discover = vi.spyOn(f.manager, 'discover').mockImplementation(async () => {
    entered.release();
    await finish.promise;
    return value;
  });
  f.remote.initializeCatalogs();
  await entered.promise;
  expect(f.remote.get(f.server.id).catalogStatus).toBe('loading');
  let settled = false;
  const one = f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  const two = f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  const watched = (async () => {
    await one;
    settled = true;
  })();
  await Promise.resolve();
  expect(settled).toBe(false);
  finish.release();
  expect(await one).toHaveLength(1);
  expect(await two).toHaveLength(1);
  await watched;
  expect(discover).toHaveBeenCalledTimes(1);
});

it('keeps a failed server visible as a safe diagnostic while other enabled catalogs remain usable', async () => {
  const f = await setup();
  const value = catalog();
  const good = f.remote.create({
    name: 'Healthy fixture',
    transport: 'streamable-http',
    endpoint: 'https://healthy.example/mcp',
    publicHeaders: {},
    secretHeaders: [],
    oauth: false,
  });
  const control = { expectedRevision: good.revision, expectedAccessEpoch: good.accessEpoch };
  f.remote.trust(good.id, {
    ...control,
    fingerprint: f.remote.preview(good.id, control).fingerprint,
  });
  vi.spyOn(f.manager, 'discover').mockImplementation((binding) =>
    binding.serverId === good.id
      ? Promise.resolve(value)
      : Promise.reject(new Error('Authorization Bearer private-provider-secret')),
  );
  expect(await f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000))).toHaveLength(1);
  expect(f.remote.diagnostics().find((entry) => entry.serverId === f.server.id)).toMatchObject({
    status: 'error',
    toolCount: 0,
    error: { code: 'MCP_CATALOG_FAILED' },
  });
  expect(JSON.stringify(f.remote.diagnostics())).not.toContain('private-provider-secret');
  vi.spyOn(f.manager, 'discover').mockResolvedValue(value);
  expect(await f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000))).toHaveLength(2);
  expect(f.remote.get(f.server.id).catalogStatus).toBe('ready');
});

it('invalidates memory and durable remote catalogs after an explicit refresh failure and retries discovery', async () => {
  const f = await setup();
  const discover = vi.spyOn(f.manager, 'discover').mockResolvedValue(catalog());
  await f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  const control = {
    expectedRevision: f.server.revision,
    expectedAccessEpoch: f.server.accessEpoch,
  };
  discover.mockRejectedValueOnce(new Error('Authorization Bearer fixture-private-secret'));
  await expect(
    f.remote.discover(f.server.id, control, AbortSignal.timeout(5000)),
  ).rejects.toThrow();
  expect(f.remote.catalog(f.server.id)).toBeNull();
  expect(f.store.mcp.directory.catalog(f.server.id, 'remote')).toBeUndefined();
  expect(f.remote.get(f.server.id)).toMatchObject({ catalogStatus: 'error' });
  expect(f.remote.diagnostics()).toMatchObject([
    { status: 'error', toolCount: 0, error: { code: 'MCP_CATALOG_FAILED' } },
  ]);
  expect(JSON.stringify(f.remote.diagnostics())).not.toContain('fixture-private-secret');
  expect(await f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000))).toHaveLength(1);
  expect(discover).toHaveBeenCalledTimes(3);
});

it('shares an explicit refresh between callers while cancellation releases only one waiter', async () => {
  const f = await setup();
  const entered = gate();
  const finish = gate();
  cleanups.push(() => {
    finish.release();
    return Promise.resolve();
  });
  const discover = vi.spyOn(f.manager, 'discover').mockImplementation(async () => {
    entered.release();
    await finish.promise;
    return catalog();
  });
  const control = {
    expectedRevision: f.server.revision,
    expectedAccessEpoch: f.server.accessEpoch,
  };
  const caller = new AbortController();
  const one = f.remote.discover(f.server.id, control, caller.signal);
  const rejected = expect(one).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise;
  expect(f.remote.get(f.server.id).catalogStatus).toBe('loading');
  const two = f.remote.discover(f.server.id, control, AbortSignal.timeout(5000));
  caller.abort();
  await rejected;
  finish.release();
  expect((await two).tools).toHaveLength(1);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(f.remote.get(f.server.id).catalogStatus).toBe('ready');
});

it('joins an in-flight background discovery when explicitly refreshing the same authority', async () => {
  const f = await setup();
  const entered = gate();
  const finish = gate();
  cleanups.push(() => {
    finish.release();
    return Promise.resolve();
  });
  const discover = vi.spyOn(f.manager, 'discover').mockImplementation(async () => {
    entered.release();
    await finish.promise;
    return catalog();
  });
  const preparing = f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  await entered.promise;
  const refreshing = f.remote.discover(
    f.server.id,
    {
      expectedRevision: f.server.revision,
      expectedAccessEpoch: f.server.accessEpoch,
    },
    AbortSignal.timeout(5000),
  );
  finish.release();
  expect(await preparing).toHaveLength(1);
  expect((await refreshing).tools).toHaveLength(1);
  expect(discover).toHaveBeenCalledTimes(1);
});

it('rejects previous-identity readonly grants in remote display, candidates and exact selection', async () => {
  const f = await setup();
  vi.spyOn(f.manager, 'discover').mockResolvedValue(catalog());
  const signal = AbortSignal.timeout(5000);
  const [tool] = await f.remote.freezeCandidates(null, 'ask', signal);
  if (tool === undefined) throw new Error('Missing remote tool');
  f.remote.grantReadOnly(f.server.id, {
    ...tool.selection,
    expectedAccessEpoch: f.server.accessEpoch,
    arguments: { owner: 'fixture' },
  });
  const [readonly] = await f.remote.freezeCandidates(null, 'read-only', signal);
  if (readonly === undefined) throw new Error('Missing readonly remote tool');
  expect(f.remote.isReadOnlyAuthorized(readonly, { owner: 'fixture' })).toBe(true);
  expect(f.remote.isReadOnlyAuthorized(readonly, { owner: 'other' })).toBe(false);
  const owner = f.store.auth.profileOwner();
  if (owner === undefined) throw new Error('Missing owner');
  f.store.mcp.revokeIdentity(owner.id);
  const control = {
    expectedRevision: f.server.revision,
    expectedAccessEpoch: f.server.accessEpoch,
  };
  f.remote.trust(f.server.id, {
    ...control,
    fingerprint: f.remote.preview(f.server.id, control).fingerprint,
  });
  await f.remote.discover(f.server.id, control, signal);
  expect(f.store.mcp.directory.grants(f.server.id)).toHaveLength(1);
  expect(f.remote.catalog(f.server.id)?.tools[0]?.readOnlyAuthorized).toBe(false);
  expect(await f.remote.freezeCandidates(null, 'read-only', signal)).toEqual([]);
  expect(() => f.remote.freezeSelections(null, 'read-only', [tool.selection], signal)).toThrow(
    '此工具没有精确只读授权',
  );
  expect(f.remote.isReadOnlyAuthorized(readonly, { owner: 'fixture' })).toBe(false);
});

it('stops an obsolete in-flight catalog from publishing after trust is revoked', async () => {
  const f = await setup();
  const entered = gate();
  const finish = gate();
  const value = catalog();
  let aborted = false;
  vi.spyOn(f.manager, 'discover').mockImplementation(async (_binding, options) => {
    options.signal.addEventListener(
      'abort',
      () => {
        aborted = true;
      },
      { once: true },
    );
    entered.release();
    await finish.promise;
    return value;
  });
  const freezing = f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  await entered.promise;
  await f.remote.disable(f.server.id, {
    expectedRevision: f.server.revision,
    expectedAccessEpoch: f.server.accessEpoch,
  });
  expect(aborted).toBe(true);
  finish.release();
  expect(await freezing).toEqual([]);
  expect(f.remote.catalog(f.server.id)).toBeNull();
  expect(f.store.mcp.directory.catalog(f.server.id, 'remote')).toBeUndefined();
});

it('cancels only one waiting Run while shared catalog preparation finishes for another', async () => {
  const f = await setup();
  const entered = gate();
  const finish = gate();
  const value = catalog();
  vi.spyOn(f.manager, 'discover').mockImplementation(async () => {
    entered.release();
    await finish.promise;
    return value;
  });
  const caller = new AbortController();
  const one = f.remote.freezeCandidates(null, 'ask', caller.signal);
  const rejected = expect(one).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise;
  const two = f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  caller.abort();
  await rejected;
  finish.release();
  expect(await two).toHaveLength(1);
});

it('rebuilds a corrupt durable catalog instead of restoring it or silently freezing no tools', async () => {
  const f = await setup();
  const value = catalog();
  vi.spyOn(f.manager, 'discover').mockResolvedValue(value);
  await f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  const stored = f.store.mcp.directory.catalog(f.server.id, 'remote');
  if (stored === undefined) throw new Error('Missing durable catalog');
  await f.remote.close();
  f.store.mcp.directory.saveCatalog(f.server.id, 'remote', {
    ...stored,
    data: '{"tools":[{"name":"invalid"}],"resources":[],"prompts":[]}',
  });
  const manager = new RemoteMcpManager();
  const discover = vi.spyOn(manager, 'discover').mockResolvedValue(value);
  const recovered = new RemoteMcpService({
    store: f.store,
    repository: f.store.remoteMcp,
    credentials: createMemoryCredentialStore(),
    manager,
  });
  cleanups.push(async () => await recovered.close());
  expect(await recovered.freezeCandidates(null, 'ask', AbortSignal.timeout(5000))).toHaveLength(1);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(recovered.get(f.server.id).catalogStatus).toBe('ready');
  expect(f.store.mcp.directory.catalog(f.server.id, 'remote')?.data).not.toContain('invalid');
});

it('limits simultaneous startup handshakes while draining all eligible servers', async () => {
  const f = await setup();
  for (let index = 0; index < 5; index += 1) {
    const server = f.remote.create({
      name: `Fixture ${index}`,
      transport: 'streamable-http',
      endpoint: `https://fixture${index}.example/mcp`,
      publicHeaders: {},
      secretHeaders: [],
      oauth: false,
    });
    const control = { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch };
    f.remote.trust(server.id, {
      ...control,
      fingerprint: f.remote.preview(server.id, control).fingerprint,
    });
  }
  const value = catalog();
  const finish = gate();
  const entered = gate();
  let active = 0;
  let maximum = 0;
  const discover = vi.spyOn(f.manager, 'discover').mockImplementation(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    if (active === 4) entered.release();
    try {
      await finish.promise;
      return value;
    } finally {
      active -= 1;
    }
  });
  f.remote.initializeCatalogs();
  const frozen = f.remote.freezeCandidates(null, 'ask', AbortSignal.timeout(5000));
  await entered.promise;
  expect(discover).toHaveBeenCalledTimes(4);
  finish.release();
  expect(await frozen).toHaveLength(6);
  expect(discover).toHaveBeenCalledTimes(6);
  expect(maximum).toBe(4);
});

async function localSetup() {
  const f = await profile();
  const project = await realpath(await mkdtemp(join(tmpdir(), 'mcp-catalog-workspace-')));
  cleanups.push(async () => await rm(project, { recursive: true, force: true }));
  const at = Date.now();
  const workspace = f.store.createWorkspace({
    id: 'project',
    name: 'Fixture',
    icon: 'folder',
    rootPath: project,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  const adapter = mcpManagerFixture();
  const options = {
    store: f.store,
    credentials: createMemoryCredentialStore(),
    profileDirectory: await realpath(f.directory),
    resolveWorkspace: () => Promise.resolve(workspace),
  };
  const local = new McpService({ ...options, manager: adapter.manager });
  cleanups.push(async () => await local.close());
  const server = await local.create({
    name: 'Local fixture',
    workspaceId: workspace.id,
    command: '/usr/bin/fixture',
    args: [],
    publicEnvironment: {},
    secretSlots: [],
  });
  const control = {
    expectedRevision: server.revision,
    expectedAccessEpoch: server.accessEpoch,
    scope: 'sandboxed' as const,
  };
  const preview = await local.preview(server.id, control);
  await local.trust(server.id, { ...control, startupFingerprint: preview.startupFingerprint });
  return { workspace, adapter, options, local };
}

it('records explicit local discovery failures in the directory state and clears obsolete snapshots', async () => {
  const { workspace, adapter, options, local } = await localSetup();
  await local.freezeCandidates(workspace.id, 'ask', AbortSignal.timeout(5000));
  const [server] = local.list();
  if (server === undefined) throw new Error('Missing local server');
  const discover = vi
    .spyOn(adapter.manager, 'discover')
    .mockRejectedValueOnce(new Error('private-secret'));
  await expect(
    local.discover(
      server.id,
      {
        expectedRevision: server.revision,
        expectedAccessEpoch: server.accessEpoch,
        scope: 'sandboxed',
      },
      AbortSignal.timeout(5000),
    ),
  ).rejects.toMatchObject({ code: 'MCP_DISCOVERY_FAILED' });
  expect(local.catalog(server.id, 'sandboxed')).toBeNull();
  expect(options.store.mcp.directory.catalog(server.id, 'sandboxed')).toBeUndefined();
  expect(local.diagnostics(workspace.id, 'ask')).toMatchObject([
    { status: 'error', toolCount: 0, error: { code: 'MCP_CATALOG_FAILED' } },
  ]);
  expect(local.get(server.id).diagnostic).toBeNull();
  expect(await local.freezeCandidates(workspace.id, 'ask', AbortSignal.timeout(5000))).toHaveLength(
    1,
  );
  expect(discover).toHaveBeenCalledTimes(2);
});

it('rejects previous-identity readonly grants consistently for a retrusted local server', async () => {
  const { workspace, options, local } = await localSetup();
  const signal = AbortSignal.timeout(5000);
  const [tool] = await local.freezeCandidates(workspace.id, 'ask', signal);
  const [server] = local.list();
  if (tool === undefined || server === undefined) throw new Error('Missing local tool');
  local.grantReadOnly(server.id, {
    ...tool.selection,
    expectedAccessEpoch: server.accessEpoch,
    arguments: { text: 'fixture' },
  });
  expect(await local.freezeCandidates(workspace.id, 'read-only', signal)).toHaveLength(1);
  await local.revokeIdentity();
  const control = {
    expectedRevision: server.revision,
    expectedAccessEpoch: server.accessEpoch,
    scope: 'sandboxed' as const,
  };
  const preview = await local.preview(server.id, control);
  await local.trust(server.id, { ...control, startupFingerprint: preview.startupFingerprint });
  await local.discover(server.id, control, signal);
  expect(options.store.mcp.directory.grants(server.id)).toHaveLength(1);
  expect(local.catalog(server.id, 'sandboxed')?.tools[0]?.readOnlyAuthorized).toBe(false);
  expect(await local.freezeCandidates(workspace.id, 'read-only', signal)).toEqual([]);
  await expect(
    local.freezeSelections(workspace.id, 'read-only', [tool.selection], signal),
  ).rejects.toThrow('此工具没有当前身份的精确只读授权');
});

it('restores local catalogs only for the explicitly trusted workspace isolation scope', async () => {
  const { workspace, adapter, options, local: first } = await localSetup();
  expect(adapter.state.starts).toBe(0);
  expect(await first.freezeCandidates(workspace.id, 'ask', AbortSignal.timeout(5000))).toHaveLength(
    1,
  );
  expect(adapter.state.starts).toBe(1);
  expect(first.diagnostics(workspace.id, 'ask')).toMatchObject([{ status: 'ready', toolCount: 1 }]);
  expect(first.diagnostics('another-workspace', 'ask')).toEqual([]);
  expect(first.diagnostics(null, 'ask')).toEqual([]);
  expect(first.diagnostics(workspace.id, 'full-access')).toEqual([]);
  await first.close();
  const secondAdapter = mcpManagerFixture();
  const second = new McpService({ ...options, manager: secondAdapter.manager });
  cleanups.push(async () => await second.close());
  expect(
    await second.freezeCandidates(workspace.id, 'ask', AbortSignal.timeout(5000)),
  ).toHaveLength(1);
  expect(secondAdapter.state.starts).toBe(0);
  expect(
    await second.freezeCandidates(workspace.id, 'full-access', AbortSignal.timeout(5000)),
  ).toEqual([]);
  expect(secondAdapter.state.starts).toBe(0);
});

it('owns local launch inspection through caller cancellation and service shutdown', async () => {
  const { workspace, adapter, local } = await localSetup();
  const entered = gate();
  const finish = gate();
  cleanups.push(() => {
    finish.release();
    return Promise.resolve();
  });
  const preview = adapter.manager.previewLaunch.bind(adapter.manager);
  vi.spyOn(adapter.manager, 'previewLaunch').mockImplementation(async (input) => {
    entered.release();
    await finish.promise;
    return await preview(input);
  });
  const caller = new AbortController();
  const pending = local.freezeCandidates(workspace.id, 'ask', caller.signal);
  await entered.promise;
  expect(local.diagnostics(workspace.id, 'ask')).toMatchObject([
    { status: 'loading', toolCount: 0 },
  ]);
  caller.abort(new DOMException('Fixture caller cancelled', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  let closed = false;
  const closing = local.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  expect(adapter.state.starts).toBe(0);
  finish.release();
  await closing;
  expect(closed).toBe(true);
  expect(adapter.state.starts).toBe(0);
});

it('ends the Run wait at its preparation deadline while retaining unfinished launch inspection', async () => {
  const { workspace, adapter, local } = await localSetup();
  const entered = gate();
  const finish = gate();
  cleanups.push(() => {
    finish.release();
    return Promise.resolve();
  });
  const preview = adapter.manager.previewLaunch.bind(adapter.manager);
  vi.spyOn(adapter.manager, 'previewLaunch').mockImplementation(async (input) => {
    entered.release();
    await finish.promise;
    return await preview(input);
  });
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  const pending = local.freezeCandidates(workspace.id, 'ask', new AbortController().signal);
  await entered.promise;
  expect(timeout).toHaveBeenCalledWith(30_000);
  deadline.abort(new DOMException('Fixture deadline elapsed', 'TimeoutError'));
  expect(await pending).toEqual([]);
  expect(local.diagnostics(workspace.id, 'ask')).toMatchObject([
    { status: 'error', toolCount: 0, error: { code: 'MCP_CATALOG_TIMEOUT' } },
  ]);
  let closed = false;
  const closing = local.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  finish.release();
  await closing;
  expect(adapter.state.starts).toBe(0);
});

async function blockReadyBinding(check: number) {
  const fixture = await localSetup();
  await fixture.local.freezeCandidates(fixture.workspace.id, 'ask', AbortSignal.timeout(5000));
  const entered = gate();
  const finish = gate();
  cleanups.push(() => {
    finish.release();
    return Promise.resolve();
  });
  const preview = fixture.adapter.manager.previewLaunch.bind(fixture.adapter.manager);
  let inspections = 0;
  vi.spyOn(fixture.adapter.manager, 'previewLaunch').mockImplementation(async (input) => {
    inspections += 1;
    if (inspections === check) {
      entered.release();
      await finish.promise;
    }
    return await preview(input);
  });
  return { ...fixture, entered, finish };
}

it.each([1, 2])(
  'cancels the Run wait during ready-catalog binding inspection %i without abandoning it',
  async (check) => {
    const { workspace, local, adapter, entered, finish } = await blockReadyBinding(check);
    const caller = new AbortController();
    const pending = local.freezeCandidates(workspace.id, 'ask', caller.signal);
    await entered.promise;
    caller.abort(new DOMException('Fixture caller cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    let closed = false;
    const closing = local.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    finish.release();
    await closing;
    expect(adapter.state.starts).toBe(1);
  },
);

it.each([1, 2])(
  'records a safe deadline failure during ready-catalog binding inspection %i',
  async (check) => {
    const { workspace, local, adapter, entered, finish } = await blockReadyBinding(check);
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const pending = local.freezeCandidates(workspace.id, 'ask', new AbortController().signal);
    await entered.promise;
    deadline.abort(new DOMException('Fixture deadline elapsed', 'TimeoutError'));
    expect(await pending).toEqual([]);
    expect(local.diagnostics(workspace.id, 'ask')).toMatchObject([
      { status: 'error', toolCount: 0, error: { code: 'MCP_CATALOG_TIMEOUT' } },
    ]);
    let closed = false;
    const closing = local.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    finish.release();
    await closing;
    expect(adapter.state.starts).toBe(1);
  },
);
