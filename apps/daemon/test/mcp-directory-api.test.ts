import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';
import {
  McpServerViewSchema,
  McpToolCatalogSchema,
  RemoteMcpViewSchema,
  WorkspaceSchema,
  type McpToolSelection,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { loadDaemonConfig } from '../src/application/config.js';
import { createApplicationServices } from '../src/application/services.js';
import { createDaemonApplication } from '../src/http/server.js';
import { loginFixture } from './support/login.js';
import { mcpManagerFixture } from './support/mcp.js';

async function fixture(remoteFixtureOrigin?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-mcp-directory-'));
  await mkdir(join(directory, 'project'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const adapter = mcpManagerFixture();
  const credentials = createMemoryCredentialStore();
  const services = await createApplicationServices(config, {
    credentials,
    mcpManager: adapter.manager,
    ...(remoteFixtureOrigin === undefined ? {} : { remoteFixtureOrigin }),
  });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  const identity = await loginFixture(origin, services);
  const send = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: identity.cookie,
        Origin: origin,
        'X-CSRF-Token': identity.csrf,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    });
  const workspace: unknown = await (
    await send('/api/workspaces', 'POST', { rootPath: join(directory, 'project') })
  ).json();
  if (!Value.Check(WorkspaceSchema, workspace)) throw new Error('Invalid workspace');
  const input = {
    name: 'Local directory',
    workspaceId: workspace.id,
    command: '/usr/bin/fixture',
    args: [],
    publicEnvironment: {},
    secretSlots: [],
  };
  const local: unknown = await (await send('/api/mcp/servers', 'POST', input)).json();
  if (!Value.Check(McpServerViewSchema, local)) throw new Error('Invalid server');
  const control = {
    expectedRevision: local.revision,
    expectedAccessEpoch: local.accessEpoch,
    scope: 'sandboxed',
  };
  const preview: unknown = await (
    await send(`/api/mcp/servers/${local.id}/trust-preview`, 'POST', control)
  ).json();
  if (!Value.Check(Type.Object({ startupFingerprint: Type.String() }), preview))
    throw new Error('Invalid preview');
  expect(
    (
      await send(`/api/mcp/servers/${local.id}/trust`, 'POST', {
        ...control,
        startupFingerprint: preview.startupFingerprint,
      })
    ).status,
  ).toBe(200);
  const catalog: unknown = await (
    await send(`/api/mcp/servers/${local.id}/discover`, 'POST', control)
  ).json();
  if (!Value.Check(McpToolCatalogSchema, catalog)) throw new Error('Invalid catalog');
  const tool = catalog.tools[0];
  if (tool === undefined) throw new Error('Missing tool');
  const selection: McpToolSelection = {
    serverId: tool.serverId,
    serverRevision: tool.serverRevision,
    remoteToolName: tool.remoteToolName,
    definitionFingerprint: tool.definitionFingerprint,
  };
  return {
    send,
    input,
    local,
    selection,
    services,
    credentials,
    origin,
    adapter,
    close: async () => {
      await application.server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function expectOAuthResult(response: Response, status: 'success' | 'error'): void {
  expect(response.status).toBe(303);
  const target = new URL(response.headers.get('location') ?? '');
  expect(target.pathname).toBe('/skill-oauth/result');
  expect(target.searchParams.get('status')).toBe(status);
  expect(target.href).not.toContain('host-fake-private');
}

describe('MCP directory management', () => {
  it('requires an enabled installed plugin App with the exact persisted server reference', async () => {
    const f = await fixture();
    try {
      const input = {
        name: 'Orphan App',
        transport: 'streamable-http' as const,
        endpoint: 'https://example.com/mcp',
        publicHeaders: {},
        secretHeaders: [],
        oauth: false,
      };
      const orphan = f.services.remoteMcp.create(input, { pluginId: 'orphan', componentId: 'app' });
      expect(
        (
          await f.send(`/api/mcp/remote-servers/${orphan.id}/trust-preview`, 'POST', {
            expectedRevision: orphan.revision,
            expectedAccessEpoch: orphan.accessEpoch,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
      const installed = await f.services.plugins.install('github', AbortSignal.timeout(5000));
      let plugin = f.services.store.extensions
        .plugins()
        .find((entry) => entry.id === installed.manifest.id);
      if (plugin === undefined) throw new Error('Missing installed plugin');
      const app = plugin.components.find((entry) => entry.kind === 'app');
      if (app === undefined) throw new Error('Missing installed App');
      await f.services.plugins.component('github', app.id, plugin.revision, true);
      const enabled = f.services.store.extensions.plugins().find((entry) => entry.id === 'github');
      if (enabled === undefined) throw new Error('Missing enabled plugin');
      plugin = enabled;
      const remote = f.services.remoteMcp.get(app.referenceId);
      const control = {
        expectedRevision: remote.revision,
        expectedAccessEpoch: remote.accessEpoch,
      };
      const preview = f.services.remoteMcp.preview(remote.id, control);
      const trusted = f.services.remoteMcp.trust(remote.id, {
        ...control,
        fingerprint: preview.fingerprint,
      });
      expect(trusted.trusted).toBe(true);
      const cases = [
        { enabled: false, components: plugin.components },
        {
          enabled: true,
          components: plugin.components.map((entry) => ({ ...entry, enabled: false })),
        },
        {
          enabled: true,
          components: plugin.components.map((entry) => ({ ...entry, referenceId: orphan.id })),
        },
      ];
      for (const state of cases) {
        plugin = f.services.store.extensions.savePlugin(
          { ...plugin, ...state, revision: plugin.revision + 1 },
          plugin.revision,
        );
        expect(f.services.remoteMcp.get(remote.id)).toMatchObject({
          enabled: false,
          trusted: false,
        });
        expect(
          (
            await f.send(`/api/mcp/remote-servers/${remote.id}/trust`, 'POST', {
              ...control,
              fingerprint: preview.fingerprint,
            })
          ).status,
        ).toBeGreaterThanOrEqual(400);
        expect(() =>
          f.services.remoteMcp.freezeSelections(
            null,
            'ask',
            'execute',
            [
              {
                serverId: remote.id,
                serverRevision: remote.revision,
                remoteToolName: 'echo',
                definitionFingerprint: 'a'.repeat(64),
              },
            ],
            AbortSignal.timeout(1000),
          ),
        ).toThrow('请先确认远程地址和认证范围');
        expect(
          await f.services.remoteMcp.freezeCandidates(
            null,
            'ask',
            'execute',
            AbortSignal.timeout(1000),
          ),
        ).toEqual([]);
      }
      await f.services.remoteMcp.remove(orphan.id, orphan.revision);
      expect(f.services.remoteMcp.owns(orphan.id)).toBe(false);
    } finally {
      await f.close();
    }
  });
  it('keeps exact readonly authorization revocable and does not revive old tool bindings after a toggle', async () => {
    const f = await fixture();
    try {
      const before = f.adapter.state.starts;
      const frozen = await f.services.mcp.freezeSelections(
        f.input.workspaceId,
        'ask',
        'execute',
        [f.selection],
        AbortSignal.timeout(1000),
      );
      expect(f.adapter.state.starts).toBe(before);
      expect(
        (
          await f.send(`/api/mcp/servers/${f.local.id}/readonly-grants`, 'POST', {
            ...f.selection,
            expectedAccessEpoch: f.local.accessEpoch,
            arguments: { text: 'allowed' },
          })
        ).status,
      ).toBe(200);
      const readonly = await f.services.mcp.freezeSelections(
        f.input.workspaceId,
        'read-only',
        'plan',
        [f.selection],
        AbortSignal.timeout(1000),
      );
      const tool = readonly[0];
      if (tool === undefined) throw new Error('Missing frozen tool');
      expect(f.services.mcp.isReadOnlyAuthorized(tool, { text: 'allowed' })).toBe(true);
      expect(f.services.mcp.isReadOnlyAuthorized(tool, { text: 'different' })).toBe(false);
      const grants: unknown = await (
        await f.send(`/api/mcp/servers/${f.local.id}/readonly-grants`)
      ).json();
      if (!Value.Check(Type.Array(Type.Object({ id: Type.String() })), grants))
        throw new Error('Invalid grant response');
      const grant = grants[0];
      if (grant === undefined) throw new Error('Missing grant');
      expect(
        (await f.send(`/api/mcp/servers/${f.local.id}/readonly-grants/${grant.id}`, 'DELETE', {}))
          .status,
      ).toBe(200);
      expect(() => f.services.mcp.assertBindingsCurrent(readonly)).toThrow();
      for (const enabled of [false, true])
        expect(
          (
            await f.send(`/api/mcp/servers/${f.local.id}/tool-control`, 'POST', {
              expectedRevision: 1,
              expectedAccessEpoch: 1,
              remoteToolName: 'echo',
              enabled,
            })
          ).status,
        ).toBe(200);
      expect(() => f.services.mcp.assertBindingsCurrent(frozen)).toThrow();
    } finally {
      await f.close();
    }
  });
  it('previews every imported configuration and exports no credentials or trust', async () => {
    const f = await fixture();
    try {
      const remote = {
        name: 'Remote configuration',
        transport: 'streamable-http',
        endpoint: 'https://example.com/mcp',
        publicHeaders: {},
        secretHeaders: [{ slotId: 'api', headerName: 'Authorization' }],
        oauth: false,
      };
      const document = { version: 1, local: [], remote: [remote] };
      const before = f.adapter.state.starts;
      expect((await f.send('/api/mcp/configuration/preview', 'POST', document)).status).toBe(200);
      expect(f.services.remoteMcp.list()).toEqual([]);
      expect((await f.send('/api/mcp/configuration/import', 'POST', document)).status).toBe(200);
      const saved = f.services.remoteMcp.list()[0];
      if (saved === undefined) throw new Error('Missing remote config');
      expect(saved).toMatchObject({ enabled: false, trusted: false, oauthConnected: false });
      expect(Value.Check(RemoteMcpViewSchema, saved)).toBe(true);
      const exported = await (await f.send('/api/mcp/configuration/export')).text();
      expect(exported).not.toContain('credentialRef');
      expect(exported).not.toContain('trusted');
      expect(exported).not.toContain('accessEpoch');
      expect(f.adapter.state.starts).toBe(before);
      expect(
        (await f.send('/api/mcp/configuration/import', 'POST', document)).status,
      ).toBeGreaterThanOrEqual(400);
      expect(f.services.remoteMcp.list()).toHaveLength(1);
      expect(
        (
          await f.send('/api/mcp/remote-servers', 'POST', {
            ...remote,
            name: 'Unsafe',
            endpoint: 'https://169.254.169.254/mcp',
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await f.send('/api/mcp/remote-servers', 'POST', {
            ...remote,
            name: 'Unsafe',
            extra: true,
          })
        ).status,
      ).toBe(400);
    } finally {
      await f.close();
    }
  });
});

async function oauthIssuer() {
  let origin = '';
  let exchanges = 0;
  let holdToken = false;
  let tokenEntered: (() => void) | undefined;
  let tokenRelease: (() => void) | undefined;
  let tokenWait = Promise.resolve();
  const server = createServer((request, response) => {
    const task = (async () => {
      response.setHeader('content-type', 'application/json');
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname.includes('oauth-protected-resource')) {
        response.end(
          JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }),
        );
        return;
      }
      if (
        url.pathname.includes('oauth-authorization-server') ||
        url.pathname.includes('openid-configuration')
      ) {
        response.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            authorization_response_iss_parameter_supported: true,
          }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      }
      if (url.pathname === '/register') {
        const metadata: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Value.Check(Type.Object({ redirect_uris: Type.Array(Type.String()) }), metadata))
          throw new Error('Invalid registration metadata');
        response.end(
          JSON.stringify({
            client_id: 'host-fixture-client',
            redirect_uris: metadata.redirect_uris,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
        );
        return;
      }
      if (url.pathname === '/token') {
        exchanges += 1;
        if (holdToken) {
          tokenEntered?.();
          await tokenWait;
        }
        response.end(
          JSON.stringify({
            access_token: 'host-fake-private-token',
            refresh_token: 'host-fake-private-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    })();
    task.catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      accept();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing issuer address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    exchanges: () => exchanges,
    holdToken(): Promise<void> {
      holdToken = true;
      tokenWait = new Promise<void>((accept) => {
        tokenRelease = accept;
      });
      return new Promise<void>((accept) => {
        tokenEntered = accept;
      });
    },
    releaseToken(): void {
      holdToken = false;
      tokenRelease?.();
    },
    close: async () => {
      tokenRelease?.();
      server.closeAllConnections();
      await new Promise<void>((accept, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else accept();
        });
      });
    },
  };
}
it('cancels only the selected MCP authorization and preserves connected credentials and startup trust', async () => {
  const issuer = await oauthIssuer();
  const f = await fixture(issuer.origin);
  try {
    const create = (name: string) => {
      const value = f.services.remoteMcp.create({
        name,
        transport: 'streamable-http',
        endpoint: `${issuer.origin}/mcp`,
        publicHeaders: {},
        secretHeaders: [],
        oauth: true,
      });
      const control = { expectedRevision: value.revision, expectedAccessEpoch: value.accessEpoch };
      const preview = f.services.remoteMcp.preview(value.id, control);
      return f.services.remoteMcp.trust(value.id, { ...control, fingerprint: preview.fingerprint });
    };
    const first = create('First OAuth fixture');
    const second = create('Second OAuth fixture');
    const control = (value: typeof first) => ({
      expectedRevision: value.revision,
      expectedAccessEpoch: value.accessEpoch,
    });
    const start = async (id: string) => {
      const value = f.services.remoteMcp.get(id);
      return await f.services.remoteMcp.beginOAuth(
        id,
        control(value),
        `${f.origin}/api/mcp/oauth/callback`,
        AbortSignal.timeout(3000),
      );
    };
    const callback = (state: string) =>
      f.send(
        `/api/mcp/oauth/callback?${new URLSearchParams({ state, code: 'fixture-code', iss: issuer.origin }).toString()}`,
      );
    const firstFlow = await start(first.id);
    const secondFlow = await start(second.id);
    expect(
      (
        await f.send(`/api/mcp/remote-servers/${first.id}/oauth/cancel`, 'POST', {
          ...control(first),
          expectedAccessEpoch: first.accessEpoch + 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.send(`/api/mcp/remote-servers/${first.id}/oauth/cancel`, 'POST', {
          ...control(first),
          extra: true,
        })
      ).status,
    ).toBe(400);
    const cancelled = await f.send(
      `/api/mcp/remote-servers/${first.id}/oauth/cancel`,
      'POST',
      control(first),
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      enabled: true,
      trusted: true,
      oauthConnected: false,
    });
    expectOAuthResult(await callback(firstFlow.state), 'error');
    expect(issuer.exchanges()).toBe(0);
    expectOAuthResult(await callback(secondFlow.state), 'success');
    expect(issuer.exchanges()).toBe(1);
    const connected = f.services.remoteMcp.get(second.id);
    expect(connected.oauthConnected).toBe(true);
    const restart = await start(second.id);
    const stored = f.services.store.remoteMcp.get(second.id);
    if (stored?.oauthCredentialRef === null || stored?.oauthCredentialRef === undefined)
      throw new Error('Missing saved OAuth credentials');
    const credentials = await f.credentials.read(stored.oauthCredentialRef);
    expect(credentials).toContain('host-fake-private-token');
    const preserved = await f.send(
      `/api/mcp/remote-servers/${second.id}/oauth/cancel`,
      'POST',
      control(connected),
    );
    expect(preserved.status).toBe(200);
    const preservedView: unknown = await preserved.json();
    if (!Value.Check(RemoteMcpViewSchema, preservedView)) throw new Error('Invalid remote view');
    const configuration = (view: typeof connected) =>
      Object.fromEntries(
        Object.entries(view).filter(([key]) => !['catalogStatus', 'catalogError'].includes(key)),
      );
    expect(configuration(preservedView)).toEqual(configuration(connected));
    expect(await f.credentials.read(stored.oauthCredentialRef)).toBe(credentials);
    expectOAuthResult(await callback(restart.state), 'error');
    expect(issuer.exchanges()).toBe(1);
    expect(
      (
        await f.send(
          `/api/mcp/remote-servers/${second.id}/oauth/cancel`,
          'POST',
          control(connected),
        )
      ).status,
    ).toBe(200);
    const exchanging = await start(second.id);
    const entered = issuer.holdToken();
    const pendingCallback = callback(exchanging.state);
    await entered;
    try {
      const aborted = await f.send(
        `/api/mcp/remote-servers/${second.id}/oauth/cancel`,
        'POST',
        control(connected),
      );
      expect(aborted.status).toBe(200);
      const abortedView: unknown = await aborted.json();
      if (!Value.Check(RemoteMcpViewSchema, abortedView)) throw new Error('Invalid remote view');
      expect(configuration(abortedView)).toEqual(configuration(connected));
      expect(await f.credentials.read(stored.oauthCredentialRef)).toBe(credentials);
      expectOAuthResult(await pendingCallback, 'error');
      expect(f.services.remoteMcp.get(second.id).oauthConnected).toBe(true);
    } finally {
      issuer.releaseToken();
      await pendingCallback;
    }
  } finally {
    await f.close();
    await issuer.close();
  }
});
it('keeps prior credentials when authorization is cancelled during credential persistence', async () => {
  const issuer = await oauthIssuer();
  const f = await fixture(issuer.origin);
  try {
    for (const connected of [false, true]) {
      const created = f.services.remoteMcp.create({
        name: `Persistence fixture ${String(connected)}`,
        transport: 'streamable-http',
        endpoint: `${issuer.origin}/mcp`,
        publicHeaders: {},
        secretHeaders: [],
        oauth: true,
      });
      const control = {
        expectedRevision: created.revision,
        expectedAccessEpoch: created.accessEpoch,
      };
      const preview = f.services.remoteMcp.preview(created.id, control);
      f.services.remoteMcp.trust(created.id, { ...control, fingerprint: preview.fingerprint });
      const start = async () =>
        await f.services.remoteMcp.beginOAuth(
          created.id,
          control,
          `${f.origin}/api/mcp/oauth/callback`,
          AbortSignal.timeout(3000),
        );
      const callback = (state: string) =>
        f.send(
          `/api/mcp/oauth/callback?${new URLSearchParams({ state, code: 'fixture-code', iss: issuer.origin }).toString()}`,
        );
      if (connected) expectOAuthResult(await callback((await start()).state), 'success');
      const before = f.services.store.remoteMcp.get(created.id);
      if (before === undefined) throw new Error('Missing fixture server');
      let encoded: string | undefined;
      if (before.oauthCredentialRef !== null)
        encoded = await f.credentials.read(before.oauthCredentialRef);
      const flow = await start();
      let enter: (() => void) | undefined;
      let release: (() => void) | undefined;
      const entered = new Promise<void>((accept) => {
        enter = accept;
      });
      const gate = new Promise<void>((accept) => {
        release = accept;
      });
      const references: string[] = [];
      const write = f.credentials.write.bind(f.credentials);
      const spy = vi.spyOn(f.credentials, 'write').mockImplementation(async (reference, value) => {
        references.push(reference);
        enter?.();
        await gate;
        await write(reference, value);
      });
      const pending = callback(flow.state);
      try {
        await entered;
        const cancel = f.services.remoteMcp.cancelOAuth(created.id, control);
        release?.();
        await cancel;
        expectOAuthResult(await pending, 'error');
        expect(f.services.store.remoteMcp.get(created.id)).toEqual(before);
        if (before.oauthCredentialRef !== null)
          expect(await f.credentials.read(before.oauthCredentialRef)).toBe(encoded);
        expect(references).toHaveLength(1);
        for (const reference of references)
          expect(await f.credentials.read(reference)).toBeUndefined();
      } finally {
        release?.();
        await pending;
        spy.mockRestore();
      }
    }
  } finally {
    await f.close();
    await issuer.close();
  }
});
it('binds MCP OAuth callbacks to one owner flow, rejects issuer mix-up and never returns token bytes', async () => {
  const issuer = await oauthIssuer();
  const f = await fixture(issuer.origin);
  try {
    const created = await f.send('/api/mcp/remote-servers', 'POST', {
      name: 'OAuth fixture',
      transport: 'streamable-http',
      endpoint: `${issuer.origin}/mcp`,
      publicHeaders: {},
      secretHeaders: [],
      oauth: true,
    });
    expect(created.status).toBe(200);
    const value: unknown = await created.json();
    if (!Value.Check(RemoteMcpViewSchema, value)) throw new Error('Invalid remote');
    const control = { expectedRevision: value.revision, expectedAccessEpoch: value.accessEpoch };
    const preview: unknown = await (
      await f.send(`/api/mcp/remote-servers/${value.id}/trust-preview`, 'POST', control)
    ).json();
    if (!Value.Check(Type.Object({ fingerprint: Type.String() }), preview))
      throw new Error('Invalid preview');
    expect(
      (
        await f.send(`/api/mcp/remote-servers/${value.id}/trust`, 'POST', {
          ...control,
          fingerprint: preview.fingerprint,
        })
      ).status,
    ).toBe(200);
    const start = async () => {
      const response = await f.send(
        `/api/mcp/remote-servers/${value.id}/oauth/start`,
        'POST',
        control,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const started: unknown = await response.json();
      if (!Value.Check(Type.Object({ url: Type.String(), state: Type.String() }), started))
        throw new Error('Invalid start');
      expect(new URL(started.url).searchParams.get('redirect_uri')).toBe(
        `${f.origin}/api/mcp/oauth/callback`,
      );
      return started;
    };
    const first = await start();
    const invalid = new URLSearchParams({
      state: first.state,
      code: 'fake-code',
      iss: 'https://wrong-issuer.example',
    });
    expectOAuthResult(await f.send(`/api/mcp/oauth/callback?${invalid.toString()}`), 'error');
    expect(issuer.exchanges()).toBe(0);
    const second = await start();
    const callback = new URLSearchParams({
      state: second.state,
      code: 'fake-code',
      iss: issuer.origin,
    });
    const result = await f.send(`/api/mcp/oauth/callback?${callback.toString()}`);
    expectOAuthResult(result, 'success');
    expect(await result.text()).not.toContain('host-fake-private');
    expect(issuer.exchanges()).toBe(1);
    expectOAuthResult(await f.send(`/api/mcp/oauth/callback?${callback.toString()}`), 'error');
    expect(issuer.exchanges()).toBe(1);
    const current = f.services.remoteMcp.get(value.id);
    expect(current.oauthConnected).toBe(true);
    expect(JSON.stringify(current)).not.toContain('host-fake-private');
    expect(await (await f.send('/api/mcp/configuration/export')).text()).not.toContain(
      'host-fake-private',
    );
    expect(
      (await f.send(`/api/mcp/remote-servers/${value.id}/oauth/disconnect`, 'POST', control))
        .status,
    ).toBe(200);
    expect(f.services.remoteMcp.get(value.id)).toMatchObject({
      enabled: false,
      trusted: false,
      oauthConnected: false,
    });
  } finally {
    await f.close();
    await issuer.close();
  }
});
