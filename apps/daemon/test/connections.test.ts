import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import {
  ConnectionViewSchema,
  type ConnectionView,
  type ConnectionServiceId,
} from '@my-pi-harness/protocol';
import { loadDaemonConfig } from '../src/application/config.js';
import { createApplicationServices } from '../src/application/services.js';
import { createDaemonApplication } from '../src/http/server.js';
import { loginFixture } from './support/login.js';
import { connectionUpstream } from './support/connections.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const upstream = await connectionUpstream();
  cleanups.push(async () => await upstream.close());
  const directory = await mkdtemp(join(tmpdir(), 'connections-api-'));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const credentials = createMemoryCredentialStore();
  const services = await createApplicationServices(config, {
    credentials,
    connectionFixtureOrigin: upstream.origin,
  });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => await application.server.close());
  const login = await loginFixture(origin, services);
  const send = async (path: string, method = 'GET', body?: unknown): Promise<Response> =>
    await fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: login.cookie,
        Origin: origin,
        'X-CSRF-Token': login.csrf,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
  const create = async (
    serviceId: ConnectionServiceId = 'github',
    mode = 'token',
  ): Promise<ConnectionView> => {
    const response = await send('/api/connections', 'POST', {
      serviceId,
      name: `${serviceId} fixture`,
      authMode: mode,
      clientId: 'fixture-client',
      scopes: [],
    });
    const value: unknown = await response.json();
    if (!Value.Check(ConnectionViewSchema, value)) throw new Error('Invalid connection response');
    return value;
  };
  return { upstream, services, send, origin, credentials, create };
}
const control = (view: ConnectionView) => ({
  expectedRevision: view.revision,
  expectedAccessEpoch: view.accessEpoch,
});
async function body(response: Response): Promise<ConnectionView> {
  const value: unknown = await response.json();
  if (!Value.Check(ConnectionViewSchema, value))
    throw new Error('Invalid public connection response');
  return value;
}
async function enablePluginApp(
  value: Awaited<ReturnType<typeof fixture>>,
  service: ConnectionServiceId,
) {
  const plugin = await value.services.plugins.install(service, new AbortController().signal);
  const app = plugin.components.find((entry) => entry.kind === 'app');
  if (app === undefined) throw new Error('Missing plugin App');
  await value.services.plugins.component(service, app.id, plugin.revision, true);
}

it('keeps protected GET inert and rejects unknown HTTP fields without exposing fake secrets', async () => {
  const value = await fixture();
  expect((await fetch(`${value.origin}/api/connections`)).status).toBe(401);
  expect((await value.send('/api/connections')).status).toBe(200);
  expect(value.upstream.calls).toHaveLength(0);
  expect(
    (
      await value.send('/api/connections', 'POST', {
        serviceId: 'github',
        name: 'test',
        authMode: 'token',
        clientId: '',
        scopes: [],
        token: 'must-not-be-a-public-field',
      })
    ).status,
  ).toBe(400);
  const connection = await value.create();
  const connected = await body(
    await value.send(`/api/connections/${connection.id}/token`, 'POST', {
      ...control(connection),
      value: 'fixture-github-token',
    }),
  );
  expect(connected.connected).toBe(true);
  expect(JSON.stringify(connected)).not.toContain('fixture-github-token');
  expect(JSON.stringify(await (await value.send('/api/connections')).json())).not.toContain(
    'credentialRef',
  );
  const count = value.upstream.calls.length;
  await value.send('/api/connections');
  await value.send('/api/connections/providers');
  expect(value.upstream.calls).toHaveLength(count);
});

it.each(['github', 'google', 'vercel', 'notion', 'supabase'] as const)(
  'keeps advanced %s credentials private and restricts their MCP endpoint',
  async (service) => {
    const value = await fixture();
    const created = await value.create(service);
    const connected = await body(
      await value.send(`/api/connections/${created.id}/token`, 'POST', {
        ...control(created),
        value: `fixture-${service}-token`,
      }),
    );
    expect(connected.accountId).toBe(`${service}-account`);
    expect(JSON.stringify(connected)).not.toContain(`fixture-${service}-token`);
    await enablePluginApp(value, service);
    const endpoint = value.services.connections
      .providers()
      .find((entry) => entry.serviceId === service)?.mcpEndpoints[0];
    if (endpoint === undefined) throw new Error('Missing provider endpoint');
    const signal = new AbortController().signal;
    expect(await value.services.connections.read(connected.id, endpoint, signal)).toBe(
      `fixture-${service}-token`,
    );
    for (const invalid of [
      'https://attacker.invalid/mcp',
      `${endpoint}unexpected`,
      endpoint.replace('https://', 'https://user:secret@'),
    ]) {
      expect(() => value.services.connections.authority(connected.id, invalid)).toThrow();
    }
    const disconnected = await value.services.connections.disconnect(
      connected.id,
      control(connected),
    );
    expect(disconnected.connected).toBe(false);
    expect(disconnected.accessEpoch).toBeGreaterThan(connected.accessEpoch);
    await expect(value.services.connections.read(connected.id, endpoint, signal)).rejects.toThrow();
  },
);

it('uses real OAuth state/PKCE/code exchange and serializes token refresh without exposing credentials', async () => {
  const value = await fixture();
  const created = await value.create('github', 'oauth');
  const configured = await value.services.connections.writeClientSecret(created.id, {
    ...control(created),
    value: 'fixture-client-secret',
  });
  const signal = new AbortController().signal;
  const start = await value.services.connections.beginOAuth(
    configured.id,
    control(configured),
    `${value.origin}/api/connections/oauth/callback/github`,
    signal,
  );
  const url = new URL(start.url);
  const state = url.searchParams.get('state');
  if (state === null) throw new Error('Missing state');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  await value.services.connections.completeOAuth(
    'github',
    new URLSearchParams({ state, code: 'fixture-code', iss: 'https://github.com/login/oauth' }),
    signal,
  );
  await expect(
    value.services.connections.completeOAuth(
      'github',
      new URLSearchParams({ state, code: 'fixture-code' }),
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONNECTION_OAUTH_EXPIRED' });
  const exchange = value.upstream.calls.find((entry) =>
    entry.path.endsWith('/login/oauth/access_token'),
  );
  const verifier = exchange?.body['code_verifier'];
  if (typeof verifier !== 'string') throw new Error('Missing PKCE verifier');
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
    url.searchParams.get('code_challenge'),
  );
  const connected = value.services.connections.get(configured.id);
  expect(connected.connected).toBe(true);
  await enablePluginApp(value, 'github');
  const stored = value.services.store.connections.get(configured.id);
  if (stored?.credentialRef === null || stored?.credentialRef === undefined)
    throw new Error('No opaque credential');
  await value.credentials.modify(stored.credentialRef, (encoded) => {
    if (encoded === undefined) throw new Error('Missing fixture credential');
    const credential: unknown = JSON.parse(encoded);
    if (typeof credential !== 'object' || credential === null)
      throw new Error('Invalid fixture credential');
    return Promise.resolve({
      value: JSON.stringify({ ...credential, expiresAt: 1 }),
      result: undefined,
    });
  });
  const [a, b] = await Promise.all([
    value.services.connections.read(connected.id, 'https://api.githubcopilot.com/mcp/', signal),
    value.services.connections.read(connected.id, 'https://api.githubcopilot.com/mcp/', signal),
  ]);
  expect(a).toBe('fixture-github-token');
  expect(b).toBe(a);
  expect(
    value.upstream.calls.filter((entry) => entry.body['grant_type'] === 'refresh_token'),
  ).toHaveLength(1);
  expect(JSON.stringify(value.services.connections.list())).not.toContain('fixture-client-secret');
  const changed = await value.services.connections.writeClientSecret(connected.id, {
    ...control(connected),
    value: 'fixture-other-secret',
  });
  expect(changed.connected).toBe(false);
  expect(changed.accountId).toBeNull();
});

it('lets explicit disconnect win against an in-flight account verification and cleans the stale secret', async () => {
  const value = await fixture();
  const created = await value.create();
  const entered = value.upstream.holdProfile();
  const saving = value.services.connections.writeToken(
    created.id,
    { ...control(created), value: 'fixture-github-token' },
    new AbortController().signal,
  );
  const rejection = expect(saving).rejects.toMatchObject({ code: 'CONNECTION_CONFLICT' });
  await entered;
  const disconnected = await value.services.connections.disconnect(created.id, control(created));
  value.upstream.releaseProfile();
  await rejection;
  expect(value.services.connections.get(created.id).accessEpoch).toBe(disconnected.accessEpoch);
  expect(value.services.connections.get(created.id).connected).toBe(false);
  expect(await value.credentials.list()).toEqual([]);
});

it.each(['google', 'vercel', 'notion', 'supabase'] as const)(
  'uses the actual %s token request format and fixed provider callback',
  async (service) => {
    const value = await fixture();
    const created = await value.create(service, 'oauth');
    const signal = new AbortController().signal;
    const configured = await value.services.connections.writeClientSecret(created.id, {
      ...control(created),
      value: 'fixture-client-secret',
    });
    const start = await value.services.connections.beginOAuth(
      configured.id,
      control(configured),
      `${value.origin}/api/connections/oauth/callback/${service}`,
      signal,
    );
    const state = new URL(start.url).searchParams.get('state');
    if (state === null) throw new Error('No state');
    await value.services.connections.completeOAuth(
      service,
      new URLSearchParams({ state, code: 'fixture-code' }),
      signal,
    );
    expect(value.services.connections.get(configured.id).connected).toBe(true);
    const exchange = value.upstream.calls.find(
      (entry) => entry.body['grant_type'] === 'authorization_code',
    );
    expect(exchange?.body['code_verifier']).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    if (service === 'notion' || service === 'supabase' || service === 'vercel')
      expect(exchange?.authorization).toMatch(/^Basic /);
  },
);

it('rejects issuer mismatch, wrong-provider and expired OAuth states before token dispatch', async () => {
  const value = await fixture();
  const created = await value.create('github', 'oauth');
  const signal = new AbortController().signal;
  const start = await value.services.connections.beginOAuth(
    created.id,
    control(created),
    `${value.origin}/api/connections/oauth/callback/github`,
    signal,
  );
  const state = new URL(start.url).searchParams.get('state');
  if (state === null) throw new Error('No state');
  await expect(
    value.services.connections.completeOAuth(
      'github',
      new URLSearchParams({ state, code: 'fixture', iss: 'https://attacker.invalid' }),
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONNECTION_OAUTH_FAILED' });
  expect(value.upstream.calls).toHaveLength(0);
  const next = await value.services.connections.beginOAuth(
    created.id,
    control(created),
    `${value.origin}/api/connections/oauth/callback/github`,
    signal,
  );
  const nextState = new URL(next.url).searchParams.get('state');
  if (nextState === null) throw new Error('No state');
  await expect(
    value.services.connections.completeOAuth(
      'google',
      new URLSearchParams({ state: nextState, code: 'fixture' }),
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONNECTION_OAUTH_STATE' });
  await expect(
    value.services.connections.completeOAuth(
      'github',
      new URLSearchParams({ state: 'unregistered-state', code: 'fixture' }),
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONNECTION_OAUTH_EXPIRED' });
  expect(value.upstream.calls).toHaveLength(0);
});
