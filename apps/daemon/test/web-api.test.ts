import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { WebServiceStatusSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { expect, it, vi } from 'vitest';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication } from '../src/http/server';
import { initializeClientFixture, loginFixture } from './support/login';

it('protects independent web credentials with application login, source and CSRF; retains them across restart without database copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-web-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const credentials = createMemoryCredentialStore();
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ results: [] })));
  const services = await createApplicationServices(config, { credentials, webFetch: transport });
  const application = await createDaemonApplication(config, undefined, services);
  try {
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${origin}/api/web/status`)).status).toBe(401);
    const initialized = await initializeClientFixture(origin);
    expect(
      (await fetch(`${origin}/api/web/status`, { headers: { Cookie: initialized.cookie } })).status,
    ).toBe(401);
    const grant = await loginFixture(origin, services);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const send = async (path: string, method: string, body?: unknown): Promise<Response> =>
      await fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect(await (await send('/api/web/status', 'GET')).json()).toEqual({
      provider: 'deepseek',
      configured: false,
    });
    const unauthorized = await fetch(`${origin}/api/web/credential`, {
      method: 'PUT',
      headers: { Cookie: grant.cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'no-csrf' }),
    });
    expect(unauthorized.status).toBe(403);
    for (const input of [
      { apiKey: '' },
      { apiKey: '   ' },
      { apiKey: 'key\r\nheader' },
      { apiKey: 'key\u0000' },
      { apiKey: 'key', baseUrl: 'https://evil.example' },
    ])
      expect((await send('/api/web/credential', 'PUT', input)).status).toBe(400);
    const response = await send('/api/web/credential', 'PUT', {
      apiKey: 'dedicated-fixture-secret',
    });
    expect(response.status).toBe(200);
    const status: unknown = await response.json();
    expect(Value.Check(WebServiceStatusSchema, status)).toBe(true);
    expect(status).toEqual({ provider: 'deepseek', configured: true });
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.stringify(services.gateway.listProviders())).not.toContain(
      'dedicated-fixture-secret',
    );
    await services.web.search({ query: 'isolated smoke' }, AbortSignal.timeout(2000));
    expect(transport).toHaveBeenCalledTimes(1);
    await application.server.close();
    const reopened = await createApplicationServices(config, { credentials, webFetch: transport });
    try {
      expect(await reopened.web.status()).toEqual({ provider: 'deepseek', configured: true });
      await reopened.web.setCredential(undefined);
      expect(await reopened.web.status()).toEqual({ provider: 'deepseek', configured: false });
    } finally {
      await reopened.close();
    }
  } finally {
    await application.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
