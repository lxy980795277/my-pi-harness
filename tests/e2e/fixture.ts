import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  AuthStatusSchema,
  DaemonReadyRecordSchema,
  LoginFlowSchema,
} from '@my-pi-harness/protocol';
import { test as base } from '@playwright/test';
import { Value } from 'typebox/value';

interface RunningDaemon {
  origin: string;
  token: string;
  loginToken: string;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}

/** Starts built daemon exports and static Web with an isolated listener per test. */
export const test = base.extend<{ daemon: RunningDaemon }>({
  page: async ({ page, daemon }, use) => {
    await page.context().addCookies([
      {
        name: 'my_pi_local',
        value: daemon.token,
        domain: new URL(daemon.origin).hostname,
        path: '/api',
        httpOnly: true,
        sameSite: 'Strict',
      },
      {
        name: 'my_pi_session',
        value: daemon.loginToken,
        domain: new URL(daemon.origin).hostname,
        path: '/api',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.route('https://avatars.githubusercontent.com/**', async (route) => {
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    });
    await use(page);
  },
  daemon: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'my-pi-browser-'));
    const ownerSecret = randomBytes(32).toString('base64url');
    const environment = { ...process.env };
    delete environment['MY_PI_HARNESS_GITHUB_CALLBACK_URL'];
    for (const name of Object.keys(environment)) {
      if (name.startsWith('MY_PI_HARNESS_SKILL_')) delete environment[name];
    }
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./start-daemon.mjs', import.meta.url))],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...environment,
          MY_PI_HARNESS_PORT: '0',
          MY_PI_HARNESS_GITHUB_CLIENT_ID: 'synthetic-e2e-client-id',
          MY_PI_HARNESS_GITHUB_CLIENT_SECRET: 'synthetic-e2e-client-secret',
          MY_PI_HARNESS_SKILL_GITHUB_CLIENT_ID: 'synthetic-browser-oauth-client-github',
          MY_PI_HARNESS_SKILL_GITHUB_CLIENT_SECRET: 'synthetic-browser-oauth-secret',
          MY_PI_HARNESS_SKILL_GOOGLE_CLIENT_ID: 'synthetic-browser-oauth-client-google',
          MY_PI_HARNESS_SKILL_GOOGLE_CLIENT_SECRET: 'synthetic-browser-oauth-secret',
          MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
          MY_PI_HARNESS_SESSION_LOG_ROOT: join(profile, '.my-pi-harness'),
          MY_PI_HARNESS_DESKTOP_SECRET: ownerSecret,
          MY_PI_HARNESS_PARENT_PID: String(process.pid),
          MY_PI_HARNESS_WEB_DIST_PATH: fileURLToPath(
            new URL('../../apps/web/dist', import.meta.url),
          ),
        },
      },
    );
    const { stdout, stderr: errorStream } = child;
    assert(stdout && errorStream, 'Daemon launch requires stdout and stderr pipes');
    let stderr = '';
    errorStream.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = once(child, 'exit');
    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> =>
      (stopPromise ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (child.connected) child.send({ type: 'daemon.shutdown' }, () => undefined);
        else child.kill('SIGTERM');
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5_000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      })());
    try {
      const origin = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        const timeout = setTimeout(
          () => fail(new Error(`Daemon readiness timed out: ${stderr}`)),
          10_000,
        );
        const cleanup = (): void => {
          clearTimeout(timeout);
          stdout.removeListener('data', receive);
          child.removeListener('error', fail);
          child.removeListener('exit', earlyExit);
        };
        const fail = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const earlyExit = (): void => fail(new Error(`Daemon exited before readiness: ${stderr}`));
        const receive = (chunk: Buffer): void => {
          buffer += chunk.toString();
          if (buffer.length > 64 * 1024) {
            fail(new Error('Oversized daemon ready record'));
            return;
          }
          const end = buffer.indexOf('\n');
          if (end === -1) return;
          try {
            const record: unknown = JSON.parse(buffer.slice(0, end));
            if (!Value.Check(DaemonReadyRecordSchema, record))
              throw new Error('Invalid daemon ready record');
            cleanup();
            resolve(`http://${record.host}:${record.port}`);
          } catch (error: unknown) {
            fail(error instanceof Error ? error : new Error('Invalid ready JSON'));
          }
        };
        stdout.on('data', receive);
        child.once('error', fail);
        child.once('exit', earlyExit);
      });
      const authorization = await fetch(`${origin}/api/auth/desktop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: ownerSecret }),
        signal: AbortSignal.timeout(5000),
      });
      const token = /^my_pi_local=([A-Za-z0-9_-]+);/.exec(
        authorization.headers.get('set-cookie') ?? '',
      )?.[1];
      await authorization.body?.cancel();
      if (!authorization.ok || !token) throw new Error('Fixture authorization failed');
      const loginToken = await loginFixture(origin, token);
      const restart = async (): Promise<void> => {
        const requestId = randomBytes(12).toString('hex');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => fail(new Error(`Fixture restart timed out: ${stderr}`)),
            15_000,
          );
          const cleanup = (): void => {
            clearTimeout(timer);
            child.removeListener('message', receive);
            child.removeListener('exit', earlyExit);
          };
          const fail = (error: Error): void => {
            cleanup();
            reject(error);
          };
          const earlyExit = (): void =>
            fail(new Error(`Fixture exited while restarting: ${stderr}`));
          const receive = (value: unknown): void => {
            if (
              typeof value !== 'object' ||
              value === null ||
              !('requestId' in value) ||
              value.requestId !== requestId ||
              !('type' in value)
            )
              return;
            if (value.type === 'fixture.restarted') {
              cleanup();
              resolve();
            }
            if (value.type === 'fixture.restart-failed')
              fail(new Error(`Fixture restart failed: ${stderr}`));
          };
          child.on('message', receive);
          child.once('exit', earlyExit);
          child.send({ type: 'fixture.restart', requestId }, (error) => {
            if (error) fail(error);
          });
        });
      };
      await use({ origin, token, loginToken, stop, restart });
    } finally {
      await stop();
      await rm(profile, { recursive: true, force: true });
    }
  },
});

/** Establish a real HTTP application session through the injected upstream provider. */
async function loginFixture(origin: string, localToken: string): Promise<string> {
  const statusResponse = await fetch(`${origin}/api/auth/status`, {
    headers: { Cookie: `my_pi_local=${localToken}` },
    signal: AbortSignal.timeout(5000),
  });
  const status: unknown = await statusResponse.json();
  if (!Value.Check(AuthStatusSchema, status) || status.csrfToken === null)
    throw new Error('Fixture trust did not provide CSRF authorization');
  const headers = {
    Cookie: `my_pi_local=${localToken}`,
    Origin: origin,
    'Content-Type': 'application/json',
    'X-CSRF-Token': status.csrfToken,
  };
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId: 'github', method: 'device' }),
    signal: AbortSignal.timeout(5000),
  });
  const flow: unknown = await login.json();
  if (!login.ok || !Value.Check(LoginFlowSchema, flow))
    throw new Error('Fixture GitHub challenge failed');
  const deadline = Date.now() + 10_000;
  let completed = flow.status === 'completed';
  while (!completed && Date.now() < deadline) {
    const response = await fetch(`${origin}/api/auth/login-flows/${flow.id}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const current: unknown = await response.json();
    if (!response.ok || !Value.Check(LoginFlowSchema, current))
      throw new Error('Fixture GitHub challenge could not be read');
    if (current.status === 'failed' || current.status === 'cancelled')
      throw new Error(`Fixture GitHub authorization ended: ${current.error}`);
    completed = current.status === 'completed';
    if (!completed) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!completed) throw new Error('Fixture GitHub authorization timed out');
  const authorization = await fetch(`${origin}/api/auth/login-flows/${flow.id}/complete`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(5000),
  });
  const token = /^my_pi_session=([A-Za-z0-9_-]+);/.exec(
    authorization.headers.get('set-cookie') ?? '',
  )?.[1];
  const authenticated: unknown = await authorization.json();
  if (
    !authorization.ok ||
    token === undefined ||
    !Value.Check(AuthStatusSchema, authenticated) ||
    !authenticated.authenticated
  )
    throw new Error('Fixture application login failed');
  return token;
}

export { expect } from '@playwright/test';
