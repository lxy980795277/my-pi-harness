import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi, type MockInstance } from 'vitest';
import { Type } from 'typebox';
import {
  RemoteMcpManager,
  type McpCatalog,
  type RemoteMcpBinding,
} from '@my-pi-harness/integrations';
import {
  PluginCredentialStore,
  createMemoryCredentialStore,
  openProfileStore,
} from '@my-pi-harness/storage';
import { PluginConnectionService } from '../src/features/plugin-connections/service.js';
import { RemoteMcpService } from '../src/features/mcp/remote-service.js';
import type { PluginRefreshDiagnostic } from '../src/features/mcp/remote-options.js';
import { SkillsService } from '../src/features/skills/service.js';
import { PluginService } from '../src/features/plugins/service.js';
import { createPluginAppPort } from '../src/features/plugins/apps.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const catalog: McpCatalog = {
  tools: [
    {
      remoteToolName: 'read_fixture',
      description: 'Read fixture',
      definitionFingerprint: 'a'.repeat(64),
      definition: { name: 'read_fixture', inputSchema: { type: 'object', properties: {} } },
      parameters: Type.Object({}, { additionalProperties: false }),
      supported: true,
      unavailableReason: null,
    },
  ],
};
async function fixture(onBackgroundError?: (diagnostic: PluginRefreshDiagnostic) => void) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'plugin-mcp-credentials-')));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const store = await openProfileStore(directory, {
    sessionLogRoot: join(directory, '.my-pi-harness'),
  });
  cleanups.push(() => {
    store.close();
    return Promise.resolve();
  });
  const now = Date.now();
  store.auth.createLocalClient({
    id: 'local',
    tokenHash: 'a'.repeat(64),
    csrfToken: 'fixture-csrf',
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
  const identity = () => {
    const owner = store.auth.profileOwner();
    if (owner === undefined) throw new Error('Missing fixture owner');
    return store.mcp.identity(owner.id);
  };
  const credentials = await PluginCredentialStore.open(join(directory, 'skill-credentials.json'));
  const manager = new RemoteMcpManager();
  const bindings: RemoteMcpBinding[] = [];
  const discover = vi.spyOn(manager, 'discover').mockImplementation((binding) => {
    bindings.push(binding);
    return Promise.resolve(catalog);
  });
  let tokenVersion = 0;
  const connections: PluginConnectionService = new PluginConnectionService({
    credentials,
    clients: { github: { clientId: 'fixture-client', clientSecret: 'fixture-secret' } },
    installed: (id) => store.extensions.plugins().find((entry) => entry.id === id),
    identity,
    origin: () => 'http://127.0.0.1:4311',
    request: (_id, url) => {
      if (url.pathname === '/user')
        return Promise.resolve(Response.json({ id: 123, login: 'fixture', name: 'Fixture' }));
      tokenVersion += 1;
      return Promise.resolve(
        Response.json({
          access_token: `private-token-${tokenVersion}`,
          refresh_token: 'private-refresh',
          expires_in: 3600,
        }),
      );
    },
    onChanged: async (id) => await remote.invalidatePlugin(id),
  });
  cleanups.push(async () => await connections.close());
  const read = vi.fn((id: string, signal: AbortSignal) => connections.readToken(id, signal));
  const remote: RemoteMcpService = new RemoteMcpService({
    store,
    repository: store.remoteMcp,
    credentials: createMemoryCredentialStore(),
    manager,
    pluginToken: { authority: (id) => connections.authority(id), read },
    ...(onBackgroundError === undefined ? {} : { onBackgroundError }),
  });
  cleanups.push(async () => await remote.close());
  const skills = new SkillsService({
    repository: store.extensions,
    profileDirectory: directory,
    resolveWorkspace: () => Promise.reject(new Error('No fixture workspace')),
  });
  cleanups.push(async () => await skills.close());
  const plugins = new PluginService({
    repository: store.extensions,
    profileDirectory: directory,
    skills,
    apps: createPluginAppPort(remote),
  });
  cleanups.push(async () => await plugins.close());
  const install = async (id = 'github') => {
    const installed = await plugins.install(id, AbortSignal.timeout(5000));
    const app = installed.components.find((entry) => entry.kind === 'app');
    if (app === undefined) throw new Error('Missing fixture App');
    return { installed, app };
  };
  const authorize = async () => {
    const started = new URL((await connections.startOAuth('github')).authorizationUrl);
    await connections.completeOAuth(
      'github',
      new URLSearchParams({ state: started.searchParams.get('state') ?? '', code: 'fixture-code' }),
    );
  };
  return {
    store,
    credentials,
    connections,
    remote,
    plugins,
    bindings,
    discover,
    read,
    install,
    authorize,
  };
}

it('keeps install and authorization inert until the App switch grants startup to its exact owned target', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  expect(f.remote.get(app.referenceId)).toMatchObject({ enabled: false, trusted: false });
  await f.authorize();
  expect(f.discover).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  await f.plugins.component('github', app.id, installed.revision, true);
  expect(f.remote.get(app.referenceId)).toMatchObject({ enabled: true, trusted: true });
  await vi.waitFor(() => {
    expect(f.remote.catalog(app.referenceId)?.tools).toHaveLength(1);
  });
  const metadata = f.remote.catalog(app.referenceId)?.tools[0];
  if (metadata === undefined) throw new Error('App enable did not discover its catalog');
  const frozen = await f.remote.freezeSelections(
    null,
    'full-access',
    'execute',
    [metadata],
    AbortSignal.timeout(5000),
  );
  expect(frozen[0]?.authorization).toMatchObject({ connectionId: 'plugin:github' });
  expect(f.bindings[0]).toMatchObject({
    endpoint: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer private-token-1' },
  });
  expect(f.bindings[0]?.authorizationKey).toMatch(/^[a-f0-9]{64}$/);
  expect(f.bindings[0]?.authorizationKey).not.toContain('private-token-1');
  expect(JSON.stringify(f.remote.list())).not.toContain('private-token-1');
  await f.connections.disconnect('github');
  expect(() => f.remote.assertBindingsCurrent(frozen)).toThrow();
  expect(f.remote.catalog(app.referenceId)).toBeNull();
  expect(f.discover).toHaveBeenCalledTimes(1);
});

it('rebuilds a missing owned App configuration at startup without granting its previous trust', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  await f.authorize();
  await f.plugins.component('github', app.id, installed.revision, true);
  await vi.waitFor(() => {
    expect(f.remote.get(app.referenceId).catalogStatus).toBe('ready');
  });
  const previous = f.remote.get(app.referenceId);
  await f.remote.remove(previous.id, previous.revision);
  await f.plugins.synchronize(AbortSignal.timeout(5000));
  const component = f.plugins
    .list()
    .find((entry) => entry.manifest.id === 'github')
    ?.components.find((entry) => entry.kind === 'app');
  if (component === undefined) throw new Error('Missing repaired component');
  expect(component.referenceId).not.toBe(app.referenceId);
  expect(component.enabled).toBe(true);
  expect(f.remote.get(component.referenceId)).toMatchObject({
    enabled: false,
    trusted: false,
    endpoint: 'https://api.githubcopilot.com/mcp/',
  });
  expect(f.discover).toHaveBeenCalledTimes(1);
  const current = f.plugins.list().find((entry) => entry.manifest.id === 'github');
  await f.plugins.synchronize(AbortSignal.timeout(5000));
  expect(f.plugins.list().find((entry) => entry.manifest.id === 'github')).toEqual(current);
  expect(f.remote.get(component.referenceId)).toMatchObject({ enabled: false, trusted: false });
});

it('repairs a missing App during an explicit enable and grants only its new exact owned target', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  await f.authorize();
  const previous = f.remote.get(app.referenceId);
  await f.remote.remove(previous.id, previous.revision);
  const enabled = await f.plugins.component('github', app.id, installed.revision, true);
  const repaired = enabled.components.find((component) => component.id === app.id);
  if (repaired === undefined) throw new Error('Missing repaired component');
  expect(repaired.referenceId).not.toBe(app.referenceId);
  expect(f.remote.get(repaired.referenceId)).toMatchObject({ enabled: true, trusted: true });
  await vi.waitFor(() => {
    expect(f.remote.get(repaired.referenceId).catalogStatus).toBe('ready');
  });
  expect(f.bindings[0]).toMatchObject({
    endpoint: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer private-token-1' },
  });
});

it('removes obsolete per-App OAuth configuration when a shared plugin credential owns its authorization', async () => {
  const f = await fixture();
  const { app } = await f.install();
  const server = f.remote.get(app.referenceId);
  await f.remote.update(server.id, {
    ...server,
    expectedRevision: server.revision,
    secretHeaders: [],
    oauth: true,
  });
  const before = f.remote.get(server.id);
  expect(before.oauth).toBe(true);
  await f.plugins.synchronize(AbortSignal.timeout(5000));
  expect(f.remote.get(server.id)).toMatchObject({
    oauth: false,
    enabled: false,
    trusted: false,
    revision: before.revision + 1,
  });
  expect(f.read).not.toHaveBeenCalled();
});

it('recovers an orphan configuration only by its exact plugin and component owner', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  const stored = f.store.extensions.plugins().find((plugin) => plugin.id === 'github');
  if (stored === undefined) throw new Error('Missing plugin');
  f.store.extensions.savePlugin(
    {
      ...stored,
      revision: installed.revision + 1,
      components: stored.components.filter((component) => component.kind !== 'app'),
    },
    installed.revision,
  );
  await f.plugins.synchronize(AbortSignal.timeout(5000));
  const recovered = f.plugins
    .list()
    .find((plugin) => plugin.manifest.id === 'github')
    ?.components.find((component) => component.kind === 'app');
  expect(recovered).toMatchObject({ referenceId: app.referenceId, enabled: false });
  expect(f.remote.list()).toHaveLength(1);
  expect(f.remote.get(app.referenceId)).toMatchObject({ enabled: false, trusted: false });
});

it('rejects a component reference to a manually created same-name server instead of taking ownership', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  const manual = f.remote.create({
    name: 'Manual GitHub',
    transport: 'streamable-http',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    publicHeaders: {},
    secretHeaders: [],
    oauth: false,
  });
  const stored = f.store.extensions.plugins().find((plugin) => plugin.id === 'github');
  if (stored === undefined) throw new Error('Missing plugin');
  f.store.extensions.savePlugin(
    {
      ...stored,
      revision: installed.revision + 1,
      components: stored.components.map((component) => {
        if (component.id === app.id) return { ...component, referenceId: manual.id };
        return component;
      }),
    },
    installed.revision,
  );
  await expect(f.plugins.synchronize(AbortSignal.timeout(5000))).rejects.toMatchObject({
    code: 'PLUGIN_APP_OWNER',
  });
  expect(f.remote.get(manual.id)).toEqual(manual);
  expect(f.remote.ownedBy(manual.id, 'github', app.id)).toBe(false);
});

it('refreshes enabled App credentials with a different private binding digest while retaining its account authority', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  await f.authorize();
  await f.plugins.component('github', app.id, installed.revision, true);
  await vi.waitFor(() => {
    expect(f.remote.catalog(app.referenceId)?.tools).toHaveLength(1);
  });
  const original = f.credentials.read('github');
  if (original === undefined) throw new Error('Missing authorized credential');
  const firstKey = f.bindings[0]?.authorizationKey;
  await f.credentials.set('github', { ...original, expiresAt: 1 }, () => undefined);
  await f.connections.status('github');
  await vi.waitFor(() => {
    expect(f.bindings.at(-1)?.headers).toMatchObject({ Authorization: 'Bearer private-token-2' });
    expect(f.remote.get(app.referenceId).catalogStatus).toBe('ready');
  });
  expect(f.bindings.at(-1)?.authorizationKey).not.toBe(firstKey);
  expect(f.connections.authority('github').accessEpoch).toBe(original.connectedAt);
  expect(JSON.stringify(f.remote.catalog(app.referenceId))).not.toContain('private-token-2');
});

it('refuses changed endpoints before token reads and keeps independent App OAuth separate', async () => {
  const f = await fixture();
  const { app } = await f.install();
  await f.authorize();
  const server = f.remote.get(app.referenceId);
  await f.remote.update(server.id, {
    ...server,
    expectedRevision: server.revision,
    endpoint: 'https://attacker.example/mcp',
    secretHeaders: [],
  });
  expect(() => f.remote.enablePluginApp(server.id, 'github', app.id)).toThrow();
  expect(f.read).not.toHaveBeenCalled();
  const notion = await f.install('notion');
  await f.plugins.component('notion', notion.app.id, notion.installed.revision, true);
  expect(f.remote.get(notion.app.referenceId)).toMatchObject({
    enabled: true,
    trusted: true,
    oauth: true,
    oauthConnected: false,
  });
  expect(f.read).not.toHaveBeenCalled();
  expect(f.discover).not.toHaveBeenCalled();
});

function blockDiscovery(discover: MockInstance<RemoteMcpManager['discover']>) {
  let entered = (): void => undefined;
  const started = new Promise<void>((accept) => {
    entered = accept;
  });
  let release = (): void => undefined;
  let aborted = false;
  discover.mockImplementationOnce(
    (_binding, options) =>
      new Promise<McpCatalog>((accept, reject) => {
        release = () => {
          accept(catalog);
        };
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new DOMException('Cancelled', 'AbortError'));
          },
          { once: true },
        );
        entered();
      }),
  );
  return {
    started,
    release: () => {
      release();
    },
    aborted: () => aborted,
  };
}

it('returns the App toggle while its owned background catalog discovery is still loading', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  await f.authorize();
  const blocked = blockDiscovery(f.discover);
  const enabling = f.plugins.component('github', app.id, installed.revision, true);
  await blocked.started;
  const enabled = await enabling;
  expect(enabled.components.find((component) => component.id === app.id)?.enabled).toBe(true);
  expect(f.remote.get(app.referenceId).catalogStatus).toBe('loading');
  blocked.release();
  await vi.waitFor(() => {
    expect(f.remote.get(app.referenceId).catalogStatus).toBe('ready');
  });
});

it('returns OAuth completion and refresh while owned App discovery waits, and disconnect cancels that work', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  await f.plugins.component('github', app.id, installed.revision, true);
  const authorizationDiscovery = blockDiscovery(f.discover);
  const authorized = f.authorize();
  await authorizationDiscovery.started;
  await authorized;
  expect((await f.connections.status('github')).isConnected).toBe(true);
  expect(f.remote.catalog(app.referenceId)).toBeNull();
  authorizationDiscovery.release();
  await vi.waitFor(() => {
    expect(f.remote.catalog(app.referenceId)?.tools).toHaveLength(1);
  });

  const original = f.credentials.read('github');
  if (original === undefined) throw new Error('Missing authorized credential');
  await f.credentials.set('github', { ...original, expiresAt: 1 }, () => undefined);
  const refreshDiscovery = blockDiscovery(f.discover);
  const refreshed = f.connections.status('github');
  await refreshDiscovery.started;
  expect((await refreshed).isConnected).toBe(true);
  expect(f.remote.catalog(app.referenceId)).toBeNull();
  await f.connections.disconnect('github');
  expect(refreshDiscovery.aborted()).toBe(true);
  refreshDiscovery.release();
  expect(f.remote.catalog(app.referenceId)).toBeNull();
});

it('aborts and drains owned background App discovery before remote shutdown completes', async () => {
  const f = await fixture();
  const { installed, app } = await f.install();
  await f.plugins.component('github', app.id, installed.revision, true);
  let entered = (): void => undefined;
  const started = new Promise<void>((accept) => {
    entered = accept;
  });
  let settle = (): void => undefined;
  let aborted = false;
  f.discover.mockImplementationOnce(
    (_binding, options) =>
      new Promise<McpCatalog>((_accept, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            settle = () => {
              reject(new DOMException('Cancelled', 'AbortError'));
            };
          },
          { once: true },
        );
        entered();
      }),
  );
  await f.authorize();
  await started;
  let closed = false;
  const closing = (async () => {
    await f.remote.close();
    closed = true;
  })();
  await vi.waitFor(() => {
    expect(aborted).toBe(true);
  });
  expect(closed).toBe(false);
  settle();
  await closing;
  expect(closed).toBe(true);
});

it('reports unexpected background discovery failures without upstream or credential details', async () => {
  const diagnostics: PluginRefreshDiagnostic[] = [];
  const f = await fixture((diagnostic) => {
    diagnostics.push(diagnostic);
  });
  const { installed, app } = await f.install();
  await f.plugins.component('github', app.id, installed.revision, true);
  f.discover.mockRejectedValueOnce(
    new Error('upstream Authorization Bearer private-token-sensitive'),
  );
  await f.authorize();
  await vi.waitFor(() => {
    expect(diagnostics).toEqual([{ code: 'MCP_APP_DISCOVERY_FAILED', serverId: app.referenceId }]);
  });
  expect(JSON.stringify(diagnostics)).not.toContain('private-token-sensitive');
  expect(f.remote.catalog(app.referenceId)).toBeNull();
  await f.remote.close();
  await f.remote.close();
});

it.each(['disable', 'remove'] as const)(
  'cancels owned background discovery on explicit App %s',
  async (action) => {
    const f = await fixture();
    const { installed, app } = await f.install();
    await f.plugins.component('github', app.id, installed.revision, true);
    const blocked = blockDiscovery(f.discover);
    await f.authorize();
    await blocked.started;
    const server = f.remote.get(app.referenceId);
    if (action === 'disable') {
      await f.remote.disable(server.id, {
        expectedRevision: server.revision,
        expectedAccessEpoch: server.accessEpoch,
      });
      expect(f.remote.catalog(server.id)).toBeNull();
    } else {
      await f.remote.remove(server.id, server.revision);
      expect(f.remote.owns(server.id)).toBe(false);
    }
    expect(blocked.aborted()).toBe(true);
  },
);
