import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { PluginOAuthError } from '@my-pi-harness/integrations';
import { Value } from 'typebox/value';
import {
  SkillConnectionStatusSchema,
  SkillOAuthStartSchema,
  SkillOAuthLaunchTicketSchema,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import type { EventInput } from '@my-pi-harness/agent-runtime';
import { loadDaemonConfig } from '../src/application/config.js';
import { createApplicationServices } from '../src/application/services.js';
import { createDaemonApplication } from '../src/http/server.js';
import { loginFixture } from './support/login.js';
import { connectionUpstream } from './support/connections.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture(
  configured = true,
  pluginGatewayFetch?: typeof fetch,
  logger?: FastifyBaseLogger,
) {
  const upstream = await connectionUpstream();
  cleanups.push(async () => await upstream.close());
  const directory = await mkdtemp(join(tmpdir(), 'plugin-auth-api-'));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
    MY_PI_HARNESS_GITHUB_CLIENT_ID: 'application-client',
    MY_PI_HARNESS_GITHUB_CLIENT_SECRET: 'application-secret',
    ...(configured
      ? {
          MY_PI_HARNESS_SKILL_GITHUB_CLIENT_ID: 'plugin-client',
          MY_PI_HARNESS_SKILL_GITHUB_CLIENT_SECRET: 'plugin-secret',
          MY_PI_HARNESS_SKILL_GOOGLE_CLIENT_ID: 'google-plugin-client',
          MY_PI_HARNESS_SKILL_GOOGLE_CLIENT_SECRET: 'google-plugin-secret',
        }
      : {}),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
    connectionFixtureOrigin: upstream.origin,
    ...(pluginGatewayFetch === undefined ? {} : { pluginGatewayFetch }),
  });
  const application = await createDaemonApplication(config, logger, services);
  const origin = await application.server.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => await application.server.close());
  const login = await loginFixture(origin, services);
  const send = async (path: string, method = 'GET', body?: unknown) =>
    await fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: login.cookie,
        Origin: origin,
        'X-CSRF-Token': login.csrf,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
  const start = async (id = 'github') => {
    const response = await send(`/api/skill-connections/${id}/oauth`, 'POST');
    expect(response.status).toBe(200);
    const value: unknown = await response.json();
    if (!Value.Check(SkillOAuthStartSchema, value)) throw new Error('Invalid plugin OAuth start');
    return new URL(value.authorizationUrl);
  };
  const status = async (id = 'github') => {
    const response = await send(`/api/skill-connections/${id}`);
    expect(response.status).toBe(200);
    const value: unknown = await response.json();
    if (!Value.Check(SkillConnectionStatusSchema, value)) throw new Error('Invalid plugin status');
    return value;
  };
  const callback = async (authorization: URL, issuer?: string) => {
    const target = new URL(authorization.searchParams.get('redirect_uri') ?? '');
    target.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    target.searchParams.set('code', 'fixture-code');
    const issuers = new Map([
      ['github.com', 'https://github.com/login/oauth'],
      ['accounts.google.com', 'https://accounts.google.com'],
    ]);
    const expectedIssuer = issuer ?? issuers.get(authorization.hostname);
    if (expectedIssuer === undefined) throw new Error('Missing fixture issuer');
    target.searchParams.set('iss', expectedIssuer);
    return await fetch(`${origin}${target.pathname}${target.search}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
  };
  return { directory, upstream, services, origin, send, start, status, callback };
}

it('protects auth mutations and accepts no browser-supplied client or secret configuration', async () => {
  const f = await fixture();
  const unauthenticated = await fetch(`${f.origin}/api/skill-connections/github/oauth`, {
    method: 'POST',
    headers: { Origin: f.origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(unauthenticated.status).toBeGreaterThanOrEqual(400);
  expect(
    (await f.send('/api/skill-connections/github/oauth', 'POST', {})).status,
  ).toBeGreaterThanOrEqual(400);
  await f.services.plugins.install('github', new AbortController().signal);
  expect(
    (
      await f.send('/api/skill-connections/github/oauth', 'POST', {
        clientId: 'browser-injected',
        clientSecret: 'browser-secret',
      })
    ).status,
  ).toBe(400);
  expect(f.upstream.calls).toHaveLength(0);
});

it('completes the dedicated GitHub callback without login cookies and persists shared private plugin tokens', async () => {
  const f = await fixture();
  const plugin = await f.services.plugins.install('github', new AbortController().signal);
  const url = await f.start();
  expect(url.searchParams.get('client_id')).toBe('plugin-client');
  expect(url.searchParams.get('scope')).toBe('repo user');
  expect(url.searchParams.get('redirect_uri')).toBe(
    `${f.origin}/api/skill-connections/github/oauth/callback`,
  );
  const completed = await f.callback(url);
  expect(completed.status).toBe(303);
  expect(completed.headers.get('set-cookie')).toBeNull();
  const result = new URL(completed.headers.get('location') ?? '');
  expect(result.pathname).toBe('/skill-oauth/result');
  expect(result.searchParams.get('status')).toBe('success');
  expect(await f.status()).toMatchObject({
    collectionId: 'github',
    isConnected: true,
    account: { id: 'github-account', username: 'github fixture' },
  });
  expect(f.services.connections.list()).toHaveLength(0);
  for (const app of plugin.components.filter((component) => component.kind === 'app')) {
    const server = f.services.remoteMcp.get(app.referenceId);
    expect(server.connectionId).toBeUndefined();
    expect(server.enabled).toBe(false);
    expect(server.trusted).toBe(false);
  }
  const tokenPath = join(f.directory, 'profile', 'skill-credentials.json');
  expect(await readFile(tokenPath, 'utf8')).toContain('fixture-github-token');
  if (process.platform !== 'win32') expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
  const replay = await f.callback(url);
  expect(new URL(replay.headers.get('location') ?? '').searchParams.get('status')).toBe('error');
  expect((await f.send('/api/skill-connections/github', 'DELETE')).status).toBe(204);
  expect(await f.status()).toMatchObject({ isConnected: false });
  expect(await readFile(tokenPath, 'utf8')).not.toContain('fixture-github-token');
});

it('does not reuse application login client configuration for plugins', async () => {
  const f = await fixture(false);
  await f.services.plugins.install('github', new AbortController().signal);
  expect(
    (await f.send('/api/skill-connections/github/oauth', 'POST', {})).status,
  ).toBeGreaterThanOrEqual(400);
  expect(await f.status()).toMatchObject({ isConnected: false });
  expect(f.upstream.calls).toHaveLength(0);
});

it('rejects the GitHub origin as an issuer before exchanging a code and accepts a new flow with the declared issuer', async () => {
  const f = await fixture();
  await f.services.plugins.install('github', new AbortController().signal);
  const rejected = await f.callback(await f.start(), 'https://github.com');
  expect(rejected.status).toBe(303);
  const result = new URL(rejected.headers.get('location') ?? '');
  expect(result.searchParams.get('status')).toBe('error');
  expect(result.searchParams.get('message')).toBe(
    '校验授权回调失败：授权响应的发行者与插件配置不一致。',
  );
  expect(f.upstream.calls).toHaveLength(0);
  expect(await f.status()).toMatchObject({ isConnected: false });
  const completed = await f.callback(await f.start());
  expect(new URL(completed.headers.get('location') ?? '').searchParams.get('status')).toBe(
    'success',
  );
  expect(await f.status()).toMatchObject({ isConnected: true });
});

it('shows a fixed client-credentials failure and logs its phase without provider details or callback secrets', async () => {
  const messages: string[] = [];
  const logger = pino({ level: 'info' }, { write: (message) => messages.push(message) });
  const f = await fixture(true, undefined, logger);
  await f.services.plugins.install('github', new AbortController().signal);
  f.upstream.failToken({
    error: 'incorrect_client_credentials',
    error_description: 'untrusted-private-secret-and-token',
    access_token: 'private-token-that-must-not-be-used',
  });
  const started = await f.start();
  const result = await f.callback(started);
  expect(result.status).toBe(303);
  const location = result.headers.get('location') ?? '';
  const message = new URL(location).searchParams.get('message');
  expect(message).toBe(
    new PluginOAuthError('token-exchange', 'incorrect-client-credentials', 200).message,
  );
  expect(await f.status()).toMatchObject({ isConnected: false });
  const log = messages.join('');
  expect(log).toContain('Plugin OAuth callback failed');
  expect(log).toContain('"phase":"token-exchange"');
  expect(log).toContain('"reason":"incorrect-client-credentials"');
  for (const secret of [
    'untrusted-private-secret-and-token',
    'private-token-that-must-not-be-used',
    'plugin-secret',
    'fixture-code',
    started.searchParams.get('state') ?? 'missing-state',
  ]) {
    expect(log).not.toContain(secret);
    expect(location).not.toContain(secret);
  }
});

it('does not publish unknown upstream errors or internal exception messages on its result page', async () => {
  const f = await fixture();
  await f.services.plugins.install('github', new AbortController().signal);
  f.upstream.failToken({
    error: 'private-provider-error-that-is-not-an-owned-code',
    error_description: 'private-provider-description',
  });
  const response = await f.callback(await f.start());
  const location = response.headers.get('location') ?? '';
  expect(new URL(location).searchParams.get('status')).toBe('error');
  expect(location).not.toContain('private-provider');
  expect(new URL(location).searchParams.get('message')).toBeTruthy();
  vi.spyOn(f.services.pluginConnections, 'completeOAuth').mockRejectedValueOnce(
    new Error('private-internal-path-and-token'),
  );
  const unexpected = await f.callback(await f.start());
  const unknownLocation = unexpected.headers.get('location') ?? '';
  expect(new URL(unknownLocation).searchParams.get('message')).toContain('本机服务日志');
  expect(unknownLocation).not.toContain('private-internal');
});

it('explains expired callback state and local credential save failures without exposing file paths', async () => {
  const f = await fixture();
  await f.services.plugins.install('github', new AbortController().signal);
  const started = await f.start();
  await f.services.pluginConnections.disconnect('github');
  const expired = await f.callback(started);
  expect(new URL(expired.headers.get('location') ?? '').searchParams.get('message')).toContain(
    '本机服务已重启',
  );
  vi.spyOn(f.services.pluginConnections, 'completeOAuth').mockRejectedValueOnce(
    Object.assign(new Error('/private/credential/path: private-token'), { code: 'EACCES' }),
  );
  const storage = await f.callback(await f.start());
  const location = storage.headers.get('location') ?? '';
  expect(new URL(location).searchParams.get('message')).toContain('目录权限');
  expect(location).not.toContain('private');
});

it('redirects a late callback after uninstall to the error result page without exchanging or restoring credentials', async () => {
  const f = await fixture();
  const plugin = await f.services.plugins.install('github', new AbortController().signal);
  const url = await f.start();
  await f.services.plugins.remove('github', plugin.revision);
  const response = await f.callback(url);
  expect(response.status).toBe(303);
  const result = new URL(response.headers.get('location') ?? '');
  expect(result.pathname).toBe('/skill-oauth/result');
  expect(result.searchParams.get('status')).toBe('error');
  expect(result.searchParams.get('name')).toBe('GitHub');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(f.upstream.calls).toHaveLength(0);
  await expect(stat(join(f.directory, 'profile', 'skill-credentials.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('redeems an installed-plugin launch ticket once without application login cookies', async () => {
  const f = await fixture();
  await f.services.plugins.install('github', new AbortController().signal);
  const ticketResponse = await f.send(
    '/api/skill-connections/github/oauth/launch-ticket',
    'POST',
    {},
  );
  expect(ticketResponse.status).toBe(200);
  const value: unknown = await ticketResponse.json();
  if (!Value.Check(SkillOAuthLaunchTicketSchema, value)) throw new Error('Invalid launch ticket');
  const launch = new URL(value.launchUrl);
  const ticket = new URLSearchParams(launch.hash.slice(1)).get('ticket');
  expect(launch.pathname).toBe('/skill-oauth/github/launch');
  const redeem = async () =>
    await fetch(`${f.origin}/api/skill-connections/github/oauth/launch`, {
      method: 'POST',
      headers: { Origin: f.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
      signal: AbortSignal.timeout(5000),
    });
  const response = await redeem();
  expect(response.status).toBe(200);
  expect(Value.Check(SkillOAuthStartSchema, await response.json())).toBe(true);
  expect((await redeem()).status).toBeGreaterThanOrEqual(400);
});

it('one Google authorization supplies all owned Apps, while uninstall revokes its file credential', async () => {
  const f = await fixture();
  const plugin = await f.services.plugins.install('google', new AbortController().signal);
  const url = await f.start('google');
  const completed = await f.callback(url);
  expect(new URL(completed.headers.get('location') ?? '').searchParams.get('status')).toBe(
    'success',
  );
  expect(await f.status('google')).toMatchObject({
    isConnected: true,
    account: { id: 'google-account', username: 'google.fixture@example.com' },
  });
  expect(plugin.components.filter((component) => component.kind === 'app')).toHaveLength(5);
  expect(f.services.connections.list()).toHaveLength(0);
  const current = f.services.plugins.list().find((entry) => entry.manifest.id === 'google');
  if (current === undefined) throw new Error('Missing plugin');
  await f.services.plugins.remove('google', current.revision);
  expect(
    await readFile(join(f.directory, 'profile', 'skill-credentials.json'), 'utf8'),
  ).not.toContain('fixture-google-token');
});

it('only daemon ToolRuntime web_fetch can enter the read gateway, which attaches the plugin token solely upstream', async () => {
  const upstreamCalls: { url: string; headers: Headers }[] = [];
  const f = await fixture(true, (input, init) => {
    let url: string;
    if (input instanceof Request) url = input.url;
    else if (input instanceof URL) url = input.href;
    else url = input;
    upstreamCalls.push({ url, headers: new Headers(init?.headers) });
    return Promise.resolve(Response.json({ full_name: 'owner/private-repository', private: true }));
  });
  await f.services.plugins.install('github', new AbortController().signal);
  await f.callback(await f.start());
  const target = '/api/skill-gateway/github/repos/owner/private-repository';
  expect((await fetch(`${f.origin}${target}`)).status).toBe(403);
  expect((await f.send(target)).status).toBe(403);
  expect(
    (
      await fetch(`${f.origin}${target}`, {
        headers: { 'X-Pi-Harness-Skill-Gateway': 'wrong-capability' },
      })
    ).status,
  ).toBe(403);
  const workspacePath = join(f.directory, 'workspace');
  await mkdir(workspacePath);
  const workspace = await f.services.workspaces.create({ rootPath: workspacePath });
  const session = f.services.runtime.createSession({
    title: 'Gateway test',
    providerId: 'fixture-provider',
    modelId: 'fixture-model',
    thinkingLevel: 'off',
    workspaceId: workspace.id,
    approvalMode: 'full-access',
  });
  const events: EventInput[] = [];
  const context: Parameters<typeof f.services.tools.createTools>[0] = {
    session,
    run: {
      id: 'gateway-fixture-run',
      sessionId: session.id,
      branchId: session.activeBranchId,
      providerId: session.providerId,
      modelId: session.modelId,
      status: 'running',
      createdAt: Date.now(),
      finishedAt: null,
      error: null,
    },
    readOnly: false,
    signal: new AbortController().signal,
    supportsImages: false,
    recorded: new Set(),
    assistantMessageId: () => 'gateway-fixture-assistant',
    commit: (incoming) => {
      events.push(...incoming);
    },
    persistenceFailure: (error) => {
      throw error;
    },
    outcomeUnknown: (message) => {
      throw new Error(message);
    },
  };
  const toolset = f.services.tools.selectToolset(session);
  const tool = f.services.tools
    .createTools(context, toolset)
    .find((entry) => entry.name === 'web_fetch');
  if (tool === undefined) throw new Error('Missing web_fetch');
  const result = await tool.execute(
    'gateway-provider-call',
    { url: `${f.origin}${target}` },
    context.signal,
  );
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result.content)).toContain('owner/private-repository');
  expect(upstreamCalls).toHaveLength(1);
  expect(upstreamCalls[0]?.url).toBe('https://api.github.com/repos/owner/private-repository');
  expect(upstreamCalls[0]?.headers.get('authorization')).toBe('Bearer fixture-github-token');
  expect(upstreamCalls[0]?.headers.has('X-Pi-Harness-Skill-Gateway')).toBe(false);
  expect(JSON.stringify(events)).not.toContain('fixture-github-token');
  expect(JSON.stringify(events)).not.toContain('X-Pi-Harness-Skill-Gateway');
  expect(JSON.stringify(events)).not.toContain('plugin-secret');
});
