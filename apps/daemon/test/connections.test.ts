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
import { loadDaemonConfig } from '../src/config.js';
import { createApplicationServices } from '../src/services.js';
import { createDaemonApplication } from '../src/server.js';
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
async function connect(
  value: Awaited<ReturnType<typeof fixture>>,
  service: ConnectionServiceId = 'github',
) {
  const created = await value.create(service);
  const connected = await body(
    await value.send(`/api/connections/${created.id}/token`, 'POST', {
      ...control(created),
      value: `fixture-${service}-token`,
    }),
  );
  await value.services.plugins.install(service, new AbortController().signal);
  const skills = await value.services.skills.list(null, new AbortController().signal);
  const skill = skills.find((entry) => entry.pluginId === service);
  if (skill === undefined) throw new Error('Plugin has no Skill');
  const frozen = await value.services.skills.freezeSelections(
    null,
    [{ id: skill.id, contentHash: skill.contentHash }],
    new AbortController().signal,
  );
  const selected = frozen[0];
  if (selected === undefined) throw new Error('No frozen Skill');
  return { connection: connected, skill: selected };
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
  'connects %s and sends only fixed gateway operations with one-run/Skill authority',
  async (service) => {
    const value = await fixture();
    const selected = await connect(value, service);
    const signal = new AbortController().signal;
    const catalog = await value.services.connections.catalog(null, [selected.skill], signal);
    expect(catalog.length).toBeGreaterThan(0);
    if (service === 'google')
      expect(new Set(catalog.map((entry) => entry.app))).toEqual(
        new Set(['Drive', 'Docs', 'Sheets', 'Slides', 'Calendar']),
      );
    const operation = catalog.find((entry) =>
      [
        'service_github_user',
        'service_google_drive_list',
        'service_vercel_projects',
        'service_notion_search',
        'service_supabase_projects',
      ].includes(entry.id),
    );
    if (operation === undefined) throw new Error('No sample fixed operation');
    const grant = await value.services.connections.freezeGrant(
      {
        runId: 'fixture-run',
        skill: selected.skill,
        connectionId: selected.connection.id,
        operations: [operation.id],
        expiresAt: Date.now() + 60_000,
      },
      signal,
    );
    let barriers = 0;
    const args: Record<string, unknown> = service === 'notion' ? { body: {} } : {};
    const input = {
      grant,
      runId: 'fixture-run',
      parentToolCallId: 'parent-call',
      operation: operation.id,
      arguments: args,
      signal,
      beforeDispatch: () => {
        barriers += 1;
        return Promise.resolve();
      },
    };
    const result = await value.services.connections.call(input);
    expect(result.kind).toBe('known');
    expect(barriers).toBe(1);
    expect(JSON.stringify(result)).not.toContain(`fixture-${service}-token`);
    expect((await value.services.connections.call({ ...input, runId: 'other-run' })).kind).toBe(
      'not-dispatched',
    );
    expect(
      (
        await value.services.connections.call({
          ...input,
          arguments: { ...args, url: 'https://attacker.invalid' },
        })
      ).kind,
    ).toBe('not-dispatched');
    value.services.connections.revokeRun('fixture-run');
    expect((await value.services.connections.call(input)).kind).toBe('not-dispatched');
  },
);

it('does not retry a write whose HTTP socket closed after dispatch and refuses old grants after disconnect/reconnect', async () => {
  const value = await fixture();
  const selected = await connect(value);
  const signal = new AbortController().signal;
  const operation = 'service_github_issue_create';
  const grant = await value.services.connections.freezeGrant(
    {
      runId: 'run',
      skill: selected.skill,
      connectionId: selected.connection.id,
      operations: [operation],
      expiresAt: Date.now() + 60_000,
    },
    signal,
  );
  const input = {
    grant,
    runId: 'run',
    parentToolCallId: 'parent',
    operation,
    arguments: { owner: 'fixture', repo: 'demo', body: { title: 'No retry' } },
    signal,
    beforeDispatch: () => Promise.resolve(),
  };
  value.upstream.dropWrites();
  expect((await value.services.connections.call(input)).kind).toBe('unknown');
  expect(value.upstream.calls.filter((entry) => entry.path.endsWith('/issues'))).toHaveLength(1);
  const disconnected = await value.services.connections.disconnect(
    selected.connection.id,
    control(selected.connection),
  );
  expect(disconnected.connected).toBe(false);
  expect((await value.services.connections.call(input)).kind).toBe('not-dispatched');
  const reconnected = await value.services.connections.writeToken(
    disconnected.id,
    { ...control(disconnected), value: 'fixture-github-token' },
    signal,
  );
  expect(reconnected.accessEpoch).toBeGreaterThan(selected.connection.accessEpoch);
  expect((await value.services.connections.call(input)).kind).toBe('not-dispatched');
});

it('retains known HTTP status and valid bounded JSON for large upstream results', async () => {
  const value = await fixture();
  const selected = await connect(value);
  const signal = new AbortController().signal;
  const grant = await value.services.connections.freezeGrant(
    {
      runId: 'large-result',
      skill: selected.skill,
      connectionId: selected.connection.id,
      operations: ['service_github_repos'],
      expiresAt: Date.now() + 60_000,
    },
    signal,
  );
  value.upstream.largeResponse();
  const result = await value.services.connections.call({
    grant,
    runId: 'large-result',
    parentToolCallId: 'parent-large',
    operation: 'service_github_repos',
    arguments: {},
    signal,
    beforeDispatch: () => Promise.resolve(),
  });
  if (result.kind !== 'known' || result.content[0]?.type !== 'text')
    throw new Error('Expected a known text result');
  expect(result.isError).toBe(false);
  expect(result.content[0].text.length).toBeLessThanOrEqual(100_000);
  const decoded: unknown = JSON.parse(result.content[0].text);
  expect(decoded).toMatchObject({
    parentToolCallId: 'parent-large',
    operation: 'service_github_repos',
    status: 200,
    result: { truncated: true },
  });
});

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
  await value.services.plugins.install('github', signal);
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

it('propagates a failed durable dispatch barrier and preserves the connection when one Run cancels before dispatch', async () => {
  const value = await fixture();
  const selected = await connect(value);
  const signal = new AbortController().signal;
  const grant = await value.services.connections.freezeGrant(
    {
      runId: 'barrier-run',
      skill: selected.skill,
      connectionId: selected.connection.id,
      operations: ['service_github_user'],
      expiresAt: Date.now() + 60_000,
    },
    signal,
  );
  const input = {
    grant,
    runId: 'barrier-run',
    parentToolCallId: 'parent',
    operation: 'service_github_user',
    arguments: {},
    signal,
    beforeDispatch: () => Promise.reject(new Error('fsync fixture failure')),
  };
  const count = value.upstream.calls.length;
  await expect(value.services.connections.call(input)).rejects.toThrow('fsync fixture failure');
  expect(value.upstream.calls).toHaveLength(count);
  const cancelled = new AbortController();
  cancelled.abort();
  expect((await value.services.connections.call({ ...input, signal: cancelled.signal })).kind).toBe(
    'not-dispatched',
  );
  expect(value.services.connections.get(selected.connection.id).connected).toBe(true);
  expect(() =>
    value.services.connections.authority(
      selected.connection.id,
      'https://api.githubcopilot.com/other',
    ),
  ).toThrow();
  expect(() =>
    value.services.connections.authority(
      selected.connection.id,
      'https://user:secret@api.githubcopilot.com/mcp/',
    ),
  ).toThrow();
});

it('does not grant a connection to another plugin Skill and rejects expired grants', async () => {
  const value = await fixture();
  const selected = await connect(value);
  const signal = new AbortController().signal;
  await expect(
    value.services.connections.freezeGrant(
      {
        runId: 'run',
        skill: {
          ...selected.skill,
          authorization: { ...selected.skill.authorization, pluginId: 'google' },
        },
        connectionId: selected.connection.id,
        operations: ['service_github_user'],
        expiresAt: Date.now() + 10000,
      },
      signal,
    ),
  ).rejects.toThrow();
  await expect(
    value.services.connections.freezeGrant(
      {
        runId: 'run',
        skill: selected.skill,
        connectionId: selected.connection.id,
        operations: ['service_github_user'],
        expiresAt: Date.now() - 1,
      },
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONNECTION_GRANT_INVALID' });
  await expect(
    value.services.connections.freezeGrant(
      {
        runId: 'run',
        skill: selected.skill,
        connectionId: selected.connection.id,
        operations: ['service_google_docs_get'],
        expiresAt: Date.now() + 10000,
      },
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONNECTION_OPERATION_FORBIDDEN' });
});
