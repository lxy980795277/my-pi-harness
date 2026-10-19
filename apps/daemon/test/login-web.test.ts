import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStatusSchema, LoginFlowSchema, type LoginFlow } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/config.js';
import { createApplicationServices, type ApplicationServices } from '../src/services.js';
import { createDaemonApplication, type DaemonApplication } from '../src/server.js';
import { pairFixture, type FixtureAuthorization } from './support/login.js';

const CLIENT_ID = 'web-fixture-client';
const CLIENT_SECRET = 'private-web-client-secret';
const ACCESS_TOKEN = 'private-github-access-token';

function deferred() {
  let release: (() => void) | undefined;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    resolve(): void {
      if (!release) throw new Error('Missing resolver');
      release();
    },
  };
}

class GitHubFixture {
  public authorization: URL | undefined;
  public holdToken = false;
  public readonly exchanging = deferred();
  public readonly releaseToken = deferred();
  public calls = 0;
  public readonly request: typeof fetch = async (input, init) => {
    this.calls += 1;
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    if (url === 'https://github.com/login/oauth/access_token') {
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected token form');
      const fields = init.body;
      expect(fields.get('client_id')).toBe(CLIENT_ID);
      expect(fields.get('client_secret')).toBe(CLIENT_SECRET);
      expect(fields.get('code')).toBe('fixture-code');
      expect(fields.get('redirect_uri')).toBe(this.authorization?.searchParams.get('redirect_uri'));
      const verifier = fields.get('code_verifier');
      if (!verifier) throw new Error('Missing PKCE verifier');
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        this.authorization?.searchParams.get('code_challenge'),
      );
      this.exchanging.resolve();
      if (this.holdToken) await this.releaseToken.promise;
      return Response.json({ access_token: ACCESS_TOKEN });
    }
    expect(url).toBe('https://api.github.com/user');
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` });
    return Response.json({
      id: 2468,
      login: 'fixture-login',
      name: 'Web Owner',
      avatar_url: 'https://avatars.githubusercontent.com/u/2468',
    });
  };
}

interface Instance {
  directory: string;
  origin: string;
  services: ApplicationServices;
  application: DaemonApplication;
  github: GitHubFixture;
}
const instances: Instance[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) {
    instance.github.releaseToken.resolve();
    await instance.application.server.close();
    await rm(instance.directory, { recursive: true, force: true });
  }
});

async function setup(
  withSecret = true,
  environment: Record<string, string> = {},
): Promise<Instance> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-web-login-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: directory,
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
    MY_PI_HARNESS_GITHUB_CLIENT_ID: CLIENT_ID,
    ...(withSecret ? { MY_PI_HARNESS_GITHUB_CLIENT_SECRET: CLIENT_SECRET } : {}),
    ...environment,
  });
  const github = new GitHubFixture();
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
    githubFetch: github.request,
  });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  const instance = { directory, origin, services, application, github };
  instances.push(instance);
  return instance;
}

function send(
  instance: Instance,
  client: FixtureAuthorization,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  return fetch(`${instance.origin}/api${path}`, {
    method,
    headers: {
      Cookie: client.cookie,
      Origin: instance.origin,
      'X-CSRF-Token': client.csrf,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
}

async function readFlow(response: Response): Promise<LoginFlow> {
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!Value.Check(LoginFlowSchema, value)) throw new Error('Invalid login flow');
  return value;
}

async function begin(instance: Instance, client: FixtureAuthorization) {
  const response = await send(instance, client, '/auth/login', 'POST', {
    providerId: 'github',
    method: 'web',
  });
  const flow = await readFlow(response);
  if (!flow.url) throw new Error('Missing authorize URL');
  const authorization = new URL(flow.url);
  instance.github.authorization = authorization;
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Missing callback cookie');
  expect(response.headers.get('set-cookie')).toContain(
    'HttpOnly; SameSite=Lax; Path=/api/auth/callback; Max-Age=',
  );
  const callback = new URL('/api/auth/callback/github', instance.origin);
  callback.searchParams.set('state', authorization.searchParams.get('state') ?? 'missing');
  callback.searchParams.set('code', 'fixture-code');
  return { flow, authorization, cookie, callback };
}

function callback(url: URL, cookie?: string): Promise<Response> {
  return fetch(url, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(5000),
  });
}

describe('browser authorization-code login', () => {
  it('accepts the GitHub authorization issuer and ignores response extensions without exposing them', async () => {
    const instance = await setup();
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const started = await begin(instance, client);
    started.callback.searchParams.set('iss', 'https://github.com/login/oauth');
    started.callback.searchParams.set('scope', 'read:user');
    started.callback.searchParams.set('provider_extension', 'synthetic-extension-value');
    const returned = await callback(started.callback, started.cookie);
    expect(returned.status).toBe(303);
    expect(returned.headers.get('location')).toBe(
      `${instance.origin}/?login_flow=${started.flow.id}`,
    );
    const completed = await send(
      instance,
      client,
      `/auth/login-flows/${started.flow.id}/complete`,
      'POST',
      {},
    );
    expect(completed.status).toBe(200);
    const status: unknown = await completed.json();
    if (!Value.Check(AuthStatusSchema, status)) throw new Error('Invalid auth status');
    expect(status.authenticated).toBe(true);
    expect(JSON.stringify(status)).not.toContain('synthetic-extension-value');
    expect(instance.github.calls).toBe(2);
  });

  it.each(['https://evil.example/oauth', 'https://github.com', 'https://github.com/login/oauth/'])(
    'rejects the mismatched authorization issuer %s before exchanging the code',
    async (issuer) => {
      const instance = await setup();
      const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
      const started = await begin(instance, client);
      started.callback.searchParams.set('iss', issuer);
      const returned = await callback(started.callback, started.cookie);
      expect(returned.status).toBe(400);
      const body: unknown = await returned.json();
      expect(body).toMatchObject({ code: 'LOGIN_ISSUER_MISMATCH' });
      expect(JSON.stringify(body)).not.toContain(issuer);
      expect(instance.github.calls).toBe(0);
      expect(
        (await send(instance, client, `/auth/login-flows/${started.flow.id}/complete`, 'POST', {}))
          .status,
      ).toBe(409);
    },
  );

  it('rejects a mismatched issuer on an error response instead of accepting the denial', async () => {
    const instance = await setup();
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const started = await begin(instance, client);
    started.callback.searchParams.delete('code');
    started.callback.searchParams.set('error', 'access_denied');
    started.callback.searchParams.set('iss', 'https://evil.example/oauth');
    const returned = await callback(started.callback, started.cookie);
    expect(returned.status).toBe(400);
    expect(await returned.json()).toMatchObject({ code: 'LOGIN_ISSUER_MISMATCH' });
    expect(instance.github.calls).toBe(0);
  });

  it.each(['iss', 'state', 'code', 'error', 'error_description', 'error_uri'])(
    'rejects repeated known callback field %s without contacting GitHub',
    async (field) => {
      const instance = await setup();
      const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
      const started = await begin(instance, client);
      if (!started.callback.searchParams.has(field))
        started.callback.searchParams.set(field, 'synthetic-value');
      started.callback.searchParams.append(field, 'synthetic-duplicate');
      const returned = await callback(started.callback, started.cookie);
      expect(returned.status).toBe(400);
      expect(await returned.json()).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(instance.github.calls).toBe(0);
    },
  );

  it.each(['', 'x'.repeat(2049)])(
    'rejects an empty or oversized authorization issuer',
    async (issuer) => {
      const instance = await setup();
      const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
      const started = await begin(instance, client);
      started.callback.searchParams.set('iss', issuer);
      const returned = await callback(started.callback, started.cookie);
      expect(returned.status).toBe(400);
      expect(await returned.json()).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(instance.github.calls).toBe(0);
    },
  );

  it('verifies S256 with a callback-only cookie then issues a Strict application session in a same-origin POST', async () => {
    const instance = await setup();
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const started = await begin(instance, client);
    expect(started.flow.deviceCode).toBeNull();
    expect(started.authorization.origin).toBe('https://github.com');
    expect(started.authorization.pathname).toBe('/login/oauth/authorize');
    expect(started.authorization.searchParams.get('scope')).toBe('read:user');
    expect(started.authorization.searchParams.get('prompt')).toBe('select_account');
    expect(started.authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(started.authorization.searchParams.get('redirect_uri')).toBe(
      `${instance.origin}/api/auth/callback/github`,
    );
    expect(
      (await send(instance, client, `/auth/login-flows/${started.flow.id}/complete`, 'POST', {}))
        .status,
    ).toBe(409);
    const returned = await callback(started.callback, started.cookie);
    expect(returned.status).toBe(303);
    expect(returned.headers.get('location')).toBe(
      `${instance.origin}/?login_flow=${started.flow.id}`,
    );
    expect(returned.headers.get('set-cookie')).not.toContain('my_pi_session');
    expect(returned.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(returned.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await send(instance, client, '/sessions')).status).toBe(401);
    expect(
      (await readFlow(await send(instance, client, `/auth/login-flows/${started.flow.id}`))).status,
    ).toBe('completed');
    const completed = await send(
      instance,
      client,
      `/auth/login-flows/${started.flow.id}/complete`,
      'POST',
      {},
    );
    expect(completed.status).toBe(200);
    const publicBody: unknown = await completed.json();
    if (!Value.Check(AuthStatusSchema, publicBody)) throw new Error('Invalid auth status');
    expect(publicBody.authenticated).toBe(true);
    expect(publicBody.user?.name).toBe('Web Owner');
    expect(publicBody.providers[0]?.methods).toEqual(['device', 'web']);
    expect(JSON.stringify(publicBody)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(publicBody)).not.toContain(CLIENT_SECRET);
    expect(completed.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/api');
    expect((await callback(started.callback, started.cookie)).status).toBe(409);
    expect(
      (await send(instance, client, `/auth/login-flows/${started.flow.id}/complete`, 'POST', {}))
        .status,
    ).toBe(409);
    expect(instance.github.calls).toBe(2);
    const sqlite = await readFile(join(instance.directory, 'data.sqlite'));
    expect(sqlite.includes(Buffer.from(ACCESS_TOKEN))).toBe(false);
    expect(sqlite.includes(Buffer.from(CLIENT_SECRET))).toBe(false);
  });

  it('rejects forged state, wrong browser nonce, missing proof, cross-client completion and cross-origin callback', async () => {
    const instance = await setup();
    const a = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const b = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const first = await begin(instance, a);
    const second = await begin(instance, b);
    instance.github.authorization = first.authorization;
    expect((await callback(first.callback)).status).toBe(400);
    expect((await callback(first.callback, second.cookie)).status).toBe(400);
    const forged = new URL(first.callback);
    forged.searchParams.set('state', 'x'.repeat(43));
    expect((await callback(forged, first.cookie)).status).toBe(400);
    expect(
      (
        await fetch(first.callback, {
          redirect: 'manual',
          headers: { Cookie: first.cookie, Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect((await callback(first.callback, first.cookie)).status).toBe(303);
    expect(
      (await send(instance, b, `/auth/login-flows/${first.flow.id}/complete`, 'POST', {})).status,
    ).toBe(404);
    expect(
      (await send(instance, a, `/auth/login-flows/${first.flow.id}/complete`, 'POST', {})).status,
    ).toBe(200);
    expect(instance.github.calls).toBe(2);
  });

  it('records safe denial and never exchanges a denied authorization code', async () => {
    const instance = await setup();
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const started = await begin(instance, client);
    started.callback.searchParams.delete('code');
    started.callback.searchParams.set('error', 'access_denied');
    started.callback.searchParams.set('error_description', 'unsafe upstream text');
    expect((await callback(started.callback, started.cookie)).status).toBe(303);
    const failed = await readFlow(
      await send(instance, client, `/auth/login-flows/${started.flow.id}`),
    );
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('拒绝');
    expect(JSON.stringify(failed)).not.toContain('unsafe upstream text');
    expect(instance.github.calls).toBe(0);
    expect(
      (await send(instance, client, `/auth/login-flows/${started.flow.id}/complete`, 'POST', {}))
        .status,
    ).toBe(409);
  });

  it.each(['cancel', 'logout'])(
    'does not accept a late code exchange after %s',
    async (operation) => {
      const instance = await setup();
      const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
      const started = await begin(instance, client);
      instance.github.holdToken = true;
      const returning = callback(started.callback, started.cookie);
      await instance.github.exchanging.promise;
      let ending: Promise<Response>;
      if (operation === 'cancel')
        ending = send(instance, client, `/auth/login-flows/${started.flow.id}`, 'DELETE', {});
      else ending = send(instance, client, '/auth/logout', 'POST', {});
      await expect
        .poll(
          async () =>
            (await readFlow(await send(instance, client, `/auth/login-flows/${started.flow.id}`)))
              .status,
        )
        .toBe('cancelled');
      instance.github.releaseToken.resolve();
      expect((await ending).ok).toBe(true);
      expect((await returning).status).toBe(303);
      expect(
        (await send(instance, client, `/auth/login-flows/${started.flow.id}/complete`, 'POST', {}))
          .status,
      ).toBe(409);
      expect((await send(instance, client, '/sessions')).status).toBe(401);
    },
  );

  it('requires web configuration without falling back to Device Flow', async () => {
    const instance = await setup(false);
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const response = await send(instance, client, '/auth/login', 'POST', {
      providerId: 'github',
      method: 'web',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LOGIN_WEB_NOT_CONFIGURED' });
    const statusResponse = await send(instance, client, '/auth/status');
    const status: unknown = await statusResponse.json();
    if (!Value.Check(AuthStatusSchema, status)) throw new Error('Invalid status');
    expect(status.providers[0]?.methods).toEqual(['device']);
    expect(instance.github.calls).toBe(0);
  });

  it('restarts an abandoned browser authorization and rejects the previous state and nonce', async () => {
    const instance = await setup();
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const first = await begin(instance, client);
    const next = await begin(instance, client);
    expect(next.flow.id).not.toBe(first.flow.id);
    expect(next.authorization.searchParams.get('state')).not.toBe(
      first.authorization.searchParams.get('state'),
    );
    expect(next.cookie).not.toBe(first.cookie);
    expect((await callback(first.callback, first.cookie)).status).toBe(400);
    expect((await callback(next.callback, first.cookie)).status).toBe(400);
    expect(
      (await send(instance, client, `/auth/login-flows/${first.flow.id}/complete`, 'POST', {}))
        .status,
    ).toBe(404);
    expect((await callback(next.callback, next.cookie)).status).toBe(303);
    expect(
      (await send(instance, client, `/auth/login-flows/${next.flow.id}/complete`, 'POST', {}))
        .status,
    ).toBe(200);
    expect(instance.github.calls).toBe(2);
  });

  it('aborts and waits for a replaced Web exchange before issuing the next challenge', async () => {
    const instance = await setup();
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const first = await begin(instance, client);
    instance.github.holdToken = true;
    const returning = callback(first.callback, first.cookie);
    await instance.github.exchanging.promise;
    const restarting = begin(instance, client);
    await expect
      .poll(async () => (await send(instance, client, `/auth/login-flows/${first.flow.id}`)).status)
      .toBe(404);
    instance.github.releaseToken.resolve();
    const next = await restarting;
    expect((await returning).status).toBe(303);
    expect(next.flow.id).not.toBe(first.flow.id);
    expect(
      (await send(instance, client, `/auth/login-flows/${first.flow.id}/complete`, 'POST', {}))
        .status,
    ).toBe(404);
    expect((await send(instance, client, '/sessions')).status).toBe(401);
  });

  it('rejects a callback hostname mismatch before sending the user to GitHub', async () => {
    const instance = await setup(true, {
      MY_PI_HARNESS_GITHUB_CALLBACK_URL: 'http://localhost:4311/api/auth/callback/github',
    });
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const response = await send(instance, client, '/auth/login', 'POST', {
      providerId: 'github',
      method: 'web',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LOGIN_CALLBACK_CONFIG_INVALID' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(instance.github.calls).toBe(0);
  });

  it('returns to the trusted Web origin even when the registered callback uses the daemon origin', async () => {
    const webOrigin = 'http://127.0.0.1:5174';
    const registeredCallback = 'http://127.0.0.1:4311/api/auth/callback/github';
    const instance = await setup(true, {
      MY_PI_HARNESS_DEVELOPMENT_ORIGIN: webOrigin,
      MY_PI_HARNESS_GITHUB_CALLBACK_URL: registeredCallback,
    });
    const client = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const response = await fetch(`${instance.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        Cookie: client.cookie,
        Origin: webOrigin,
        'X-CSRF-Token': client.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerId: 'github', method: 'web' }),
    });
    const flow = await readFlow(response);
    if (!flow.url) throw new Error('Missing authorize URL');
    const authorization = new URL(flow.url);
    instance.github.authorization = authorization;
    expect(authorization.searchParams.get('redirect_uri')).toBe(registeredCallback);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Missing callback proof');
    const result = await instance.application.server.inject({
      method: 'GET',
      url: `/api/auth/callback/github?state=${authorization.searchParams.get('state')}&code=fixture-code`,
      headers: { Host: '127.0.0.1:4311', Cookie: cookie },
    });
    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toBe(`${webOrigin}/?login_flow=${flow.id}`);
  });
});
