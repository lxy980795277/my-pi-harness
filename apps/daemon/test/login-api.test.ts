import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthStatusSchema,
  LoginFlowSchema,
  type AuthStatus,
  type LoginFlow,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import {
  createApplicationServices,
  type ApplicationServices,
} from '../src/application/services.js';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server.js';
import { pairFixture, type FixtureAuthorization } from './support/login.js';
import { readSseRecord } from './support/sse.js';

const OWNER_SECRET = 'login-api-test-owner-000000000000000000000000000000';
class GitHubFixture {
  public subject = 13579;
  public name = 'Local Owner';
  public offline = false;
  public pending = false;
  private sequence = 0;
  public readonly request: typeof fetch = (input): Promise<Response> => {
    if (this.offline) return Promise.reject(new Error('offline'));
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    if (url.endsWith('/device/code')) {
      this.sequence += 1;
      return Promise.resolve(
        Response.json({
          device_code: `private-device-${this.sequence}`,
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 60,
          interval: 1,
        }),
      );
    }
    if (url.endsWith('/access_token')) {
      if (this.pending) return Promise.resolve(Response.json({ error: 'authorization_pending' }));
      return Promise.resolve(Response.json({ access_token: 'private-github-bearer' }));
    }
    return Promise.resolve(
      Response.json({
        id: this.subject,
        login: 'renameable-login',
        name: this.name,
        avatar_url: `https://avatars.githubusercontent.com/u/${this.subject}`,
      }),
    );
  };
}
interface Instance {
  directory: string;
  origin: string;
  services: ApplicationServices;
  application: DaemonApplication;
  github: GitHubFixture;
}
const owned: Instance[] = [];
afterEach(async () => {
  for (const instance of owned.splice(0)) {
    await instance.application.server.close();
    await rm(instance.directory, { recursive: true, force: true });
  }
});

async function setup(directory?: string, github = new GitHubFixture()): Promise<Instance> {
  const profile = directory ?? (await mkdtemp(join(tmpdir(), 'my-pi-login-api-')));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(profile, '.my-pi-harness'),
    MY_PI_HARNESS_DESKTOP_SECRET: OWNER_SECRET,
    MY_PI_HARNESS_GITHUB_CLIENT_ID: 'synthetic-client',
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
    githubFetch: github.request,
  });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  const instance = { directory: profile, origin, services, application, github };
  owned.push(instance);
  return instance;
}
function send(
  instance: Instance,
  grant: FixtureAuthorization,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  return fetch(`${instance.origin}/api${path}`, {
    method,
    headers: {
      Cookie: grant.cookie,
      Origin: instance.origin,
      'X-CSRF-Token': grant.csrf,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
}
async function status(response: Response): Promise<AuthStatus> {
  const value: unknown = await response.json();
  if (!Value.Check(AuthStatusSchema, value)) throw new Error('Invalid auth status');
  return value;
}
async function flow(response: Response): Promise<LoginFlow> {
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!Value.Check(LoginFlowSchema, value)) throw new Error('Invalid login flow');
  return value;
}
async function login(
  instance: Instance,
  grant: FixtureAuthorization,
): Promise<{ grant: FixtureAuthorization; status: AuthStatus; flowId: string }> {
  const started = await flow(
    await send(instance, grant, '/auth/login', 'POST', { providerId: 'github' }),
  );
  expect(JSON.stringify(started)).not.toContain('private-device');
  await expect
    .poll(
      async () =>
        (await flow(await send(instance, grant, `/auth/login-flows/${started.id}`))).status,
    )
    .toBe('completed');
  const completed = await send(
    instance,
    grant,
    `/auth/login-flows/${started.id}/complete`,
    'POST',
    {},
  );
  expect(completed.status).toBe(200);
  const cookie = completed.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('No application cookie');
  expect(completed.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/api');
  return {
    grant: { cookie: `${grant.cookie}; ${cookie}`, csrf: grant.csrf },
    status: await status(completed),
    flowId: started.id,
  };
}

describe('persistent application login over HTTP', () => {
  it('requires login for all private surfaces and checks Origin/CSRF before starting a flow', async () => {
    const instance = await setup();
    const grant = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    for (const path of [
      '/providers',
      '/settings',
      '/sessions',
      '/workspaces',
      '/auth-flows',
      '/attachments/missing/content',
      '/sessions/missing/events',
    ]) {
      expect((await send(instance, grant, path)).status, path).toBe(401);
    }
    const missingCsrf = await fetch(`${instance.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        Cookie: grant.cookie,
        Origin: instance.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerId: 'github' }),
    });
    expect(missingCsrf.status).toBe(403);
    const crossSite = await fetch(`${instance.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        Cookie: grant.cookie,
        Origin: 'https://evil.example',
        'X-CSRF-Token': grant.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerId: 'github' }),
    });
    expect(crossSite.status).toBe(403);
    expect(
      (await send(instance, grant, '/auth/login', 'POST', { providerId: 'other' })).status,
    ).toBe(409);
    expect(
      (await send(instance, grant, '/auth/login', 'POST', { providerId: 'github', extra: true }))
        .status,
    ).toBe(400);
    expect((await send(instance, grant, '/auth/pairing-code', 'POST', {})).status).toBe(401);
  });

  it('binds a flow to its client, signs in once, and rejects another account without changing profile data', async () => {
    const instance = await setup();
    const a = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const b = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const started = await flow(
      await send(instance, a, '/auth/login', 'POST', { providerId: 'github' }),
    );
    expect((await send(instance, b, `/auth/login-flows/${started.id}`)).status).toBe(404);
    expect((await send(instance, b, `/auth/login-flows/${started.id}`, 'DELETE', {})).status).toBe(
      404,
    );
    expect(
      (await send(instance, b, `/auth/login-flows/${started.id}/complete`, 'POST', {})).status,
    ).toBe(404);
    await expect
      .poll(
        async () => (await flow(await send(instance, a, `/auth/login-flows/${started.id}`))).status,
      )
      .toBe('completed');
    const response = await send(
      instance,
      a,
      `/auth/login-flows/${started.id}/complete`,
      'POST',
      {},
    );
    const first = await status(response);
    expect(first.authenticated).toBe(true);
    expect(first.user?.name).toBe('Local Owner');
    expect(first.profileBound).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/private-device|private-github-bearer|tokenHash/);
    expect(
      (await send(instance, a, `/auth/login-flows/${started.id}/complete`, 'POST', {})).status,
    ).toBe(409);
    instance.github.subject = 24680;
    const wrong = await flow(
      await send(instance, b, '/auth/login', 'POST', { providerId: 'github' }),
    );
    await expect
      .poll(
        async () => (await flow(await send(instance, b, `/auth/login-flows/${wrong.id}`))).status,
      )
      .toBe('completed');
    const mismatch = await send(instance, b, `/auth/login-flows/${wrong.id}/complete`, 'POST', {});
    expect(mismatch.status).toBe(409);
    expect(mismatch.headers.get('set-cookie')).toBeNull();
    expect(instance.services.store.auth.profileOwner()?.id).toBe(first.user?.id);
    expect((await status(await send(instance, b, '/auth/status'))).user).toBeNull();
  });

  it('restores both cookies after restart while offline, and bootstrap never restores logout', async () => {
    let instance = await setup();
    const paired = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const signed = await login(instance, paired);
    const directory = instance.directory;
    const github = instance.github;
    await instance.application.server.close();
    owned.splice(owned.indexOf(instance), 1);
    github.offline = true;
    instance = await setup(directory, github);
    const restored = await status(await send(instance, signed.grant, '/auth/status'));
    expect(restored.authenticated).toBe(true);
    expect(restored.user?.id).toBe(signed.status.user?.id);
    expect((await send(instance, signed.grant, '/sessions')).status).toBe(200);
    const bootstrap = await send(instance, signed.grant, '/auth/desktop', 'POST', {
      secret: OWNER_SECRET,
    });
    expect(bootstrap.headers.get('set-cookie')?.split(';')[0]).toBe(paired.cookie);
    expect((await send(instance, signed.grant, '/auth/logout', 'POST', {})).status).toBe(200);
    expect((await send(instance, signed.grant, '/sessions')).status).toBe(401);
    await send(instance, signed.grant, '/auth/desktop', 'POST', { secret: OWNER_SECRET });
    const loggedOut = await status(await send(instance, signed.grant, '/auth/status'));
    expect(loggedOut.localAuthorized).toBe(true);
    expect(loggedOut.authenticated).toBe(false);
    expect(loggedOut.user).toBeNull();
    await instance.application.server.close();
    const sqlite = await readFile(join(directory, 'data.sqlite'));
    expect(sqlite.includes(Buffer.from('private-github-bearer'))).toBe(false);
    expect(
      sqlite.includes(Buffer.from(signed.grant.cookie.split('my_pi_session=')[1] ?? 'missing')),
    ).toBe(false);
  });

  it('immediately closes private SSE on logout and retains another client login', async () => {
    const instance = await setup();
    const a = await login(
      instance,
      await pairFixture(instance.origin, instance.services.auth.pairingCode),
    );
    const b = await login(
      instance,
      await pairFixture(instance.origin, instance.services.auth.pairingCode),
    );
    instance.services.store.createSession({
      id: 'private-session',
      branchId: 'main',
      title: 'Private',
      providerId: 'fixture',
      modelId: 'fixture',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: Date.now(),
    });
    const controller = new AbortController();
    const response = await fetch(`${instance.origin}/api/sessions/private-session/events`, {
      headers: { Cookie: a.grant.cookie },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No SSE body');
    try {
      await readSseRecord(reader);
      expect((await send(instance, a.grant, '/auth/logout', 'POST', {})).status).toBe(200);
      let ended = false;
      while (!ended) ended = (await reader.read()).done;
      expect((await send(instance, a.grant, '/sessions')).status).toBe(401);
      expect((await send(instance, b.grant, '/sessions')).status).toBe(200);
    } finally {
      controller.abort();
      await reader.cancel();
    }
  });

  it('rejects expired login cookies without revoking the local client', async () => {
    const instance = await setup();
    const paired = await pairFixture(instance.origin, instance.services.auth.pairingCode);
    const token = paired.cookie.slice(paired.cookie.indexOf('=') + 1);
    const client = instance.services.store.auth.findLocalClient(
      createHash('sha256').update(token).digest('hex'),
      Date.now(),
    );
    if (!client) throw new Error('No local client');
    const loginToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    instance.services.store.auth.completeLogin(
      {
        providerId: 'github',
        issuer: 'https://github.com',
        subject: '13579',
        name: 'Owner',
        avatarUrl: null,
      },
      client.id,
      {
        id: randomUUID(),
        tokenHash: createHash('sha256').update(loginToken).digest('hex'),
        createdAt: now - 2000,
        expiresAt: now - 1000,
      },
    );
    const stale = { ...paired, cookie: `${paired.cookie}; my_pi_session=${loginToken}` };
    const current = await status(await send(instance, stale, '/auth/status'));
    expect(current.localAuthorized).toBe(true);
    expect(current.authenticated).toBe(false);
    expect((await send(instance, stale, '/settings')).status).toBe(401);
  });
});
