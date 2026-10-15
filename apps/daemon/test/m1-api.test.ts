import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/config.js';
import { createApplicationServices, type ApplicationServices } from '../src/services.js';
import { createDaemonApplication, type DaemonApplication } from '../src/server.js';

const owned: {
  directory: string;
  application: DaemonApplication;
  services: ApplicationServices;
}[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    await item.application.server.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});
async function setup(): Promise<{ origin: string; services: ApplicationServices }> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: directory,
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
    MY_PI_HARNESS_DESKTOP_SECRET: 'owner-secret-for-test-00000000000000000000000000000',
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
  });
  const application = await createDaemonApplication(config, undefined, services);
  owned.push({ directory, services, application });
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  return { origin, services };
}
async function pair(origin: string, code: string): Promise<{ cookie: string; csrf: string }> {
  const response = await fetch(`${origin}/api/auth/pair`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  expect(response.status).toBe(200);
  const status: unknown = await response.json();
  if (
    typeof status !== 'object' ||
    status === null ||
    !('csrfToken' in status) ||
    typeof status.csrfToken !== 'string'
  )
    throw new Error('No CSRF token');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('No cookie');
  return { cookie, csrf: status.csrfToken };
}

describe('M1 application authorization and settings', () => {
  it('validates atomic model settings and applies only a usable saved default to new sessions', async () => {
    const { origin, services } = await setup();
    const grant = await pair(origin, services.auth.pairingCode);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const send = (path: string, method: string, body: unknown): Promise<Response> =>
      fetch(`${origin}${path}`, { method, headers, body: JSON.stringify(body) });
    expect((await send('/api/sessions', 'POST', { title: 'No selection' })).status).toBe(422);
    const provider = {
      id: 'keyless',
      name: 'Local',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1/v1',
      models: [],
      enabled: true,
      requiresApiKey: false,
    };
    expect((await send('/api/providers', 'POST', provider)).status).toBe(200);
    const model = {
      id: 'model',
      name: 'Model',
      api: 'openai-completions',
      contextWindow: 8192,
      maxTokens: 1024,
      reasoning: false,
      input: ['text'],
    };
    expect(
      (
        await send('/api/providers/keyless', 'PUT', {
          ...provider,
          expectedRevision: 1,
          models: [{ ...model, supportedThinkingLevels: ['off'] }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('/api/providers/keyless', 'PUT', {
          ...provider,
          expectedRevision: 1,
          models: [model],
        })
      ).status,
    ).toBe(200);
    const catalog: unknown = await (
      await fetch(`${origin}/api/providers/keyless/models`, { headers })
    ).json();
    expect(catalog).toEqual([expect.objectContaining({ supportedThinkingLevels: ['off'] })]);
    expect(
      (
        await send('/api/providers/keyless', 'PUT', {
          ...provider,
          expectedRevision: 1,
          models: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send('/api/settings', 'PUT', {
          expectedRevision: 1,
          defaultModel: { providerId: 'keyless', modelId: 'model', thinkingLevel: 'off' },
        })
      ).status,
    ).toBe(200);
    const session = await send('/api/sessions', 'POST', { title: 'Uses default' });
    expect(session.status).toBe(200);
    const snapshot: unknown = await session.json();
    expect(snapshot).toMatchObject({
      session: { providerId: 'keyless', modelId: 'model', thinkingLevel: 'off' },
    });
    expect(
      (
        await send('/api/providers/keyless', 'PUT', {
          ...provider,
          expectedRevision: 2,
          models: [],
        })
      ).status,
    ).toBe(200);
    expect((await send('/api/sessions', 'POST', { title: 'Invalid default' })).status).toBe(404);
    expect(services.runtime.listSessions()).toHaveLength(1);
    const native = (await services.gateway.listProviders()).find(
      (config) => config.kind === 'builtin',
    );
    if (!native) throw new Error('Missing native slot');
    expect(
      (
        await send(`/api/providers/${native.id}`, 'PUT', {
          ...provider,
          id: native.id,
          kind: 'builtin',
          builtinId: native.builtinId,
          api: null,
          baseUrl: null,
          expectedRevision: native.revision,
        })
      ).status,
    ).toBe(422);
    expect((await send(`/api/providers/${native.id}`, 'DELETE', {})).status).toBe(422);
  });
  it('rejects private reads, foreign origins, DNS rebinding and missing CSRF', async () => {
    const { origin, services } = await setup();
    expect((await fetch(`${origin}/api/providers`)).status).toBe(401);
    const code = services.auth.pairingCode;
    expect(
      (
        await fetch(`${origin}/api/auth/pair`, {
          method: 'POST',
          headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
      ).status,
    ).toBe(403);
    const granted = await pair(origin, code);
    const rebound = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${origin}/api/providers`,
        { headers: { Cookie: granted.cookie, Host: 'foreign.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.once('error', reject);
      request.end();
    });
    expect(rebound).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/providers`, {
          method: 'POST',
          headers: { Cookie: granted.cookie, Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${origin}/api/providers`, { headers: { Cookie: granted.cookie } })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${origin}/api/auth/pair`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
      ).status,
    ).toBe(401);
  });

  it('rejects unknown fields and types, returns six native integrations and revokes the cookie', async () => {
    const { origin, services } = await setup();
    const grant = await pair(origin, services.auth.pairingCode);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const catalog: unknown = await (
      await fetch(`${origin}/api/providers/catalog`, { headers })
    ).json();
    expect(Array.isArray(catalog) && catalog.length).toBe(6);
    const base = {
      name: 'invalid',
      kind: 'custom',
      requiresApiKey: true,
      builtinId: null,
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: [],
      enabled: true,
    };
    expect(
      (
        await fetch(`${origin}/api/providers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...base, secret: 'must-never-be-config' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}/api/providers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...base, enabled: 'true' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers, body: '{}' })).status,
    ).toBe(200);
    expect((await fetch(`${origin}/api/sessions`, { headers })).status).toBe(401);
  });

  it('keeps secrets in the injected credential store and rejects stale revisions', async () => {
    const { origin, services } = await setup();
    const grant = await pair(origin, services.auth.pairingCode);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const input = {
      id: 'account',
      name: 'test',
      kind: 'custom',
      requiresApiKey: true,
      builtinId: null,
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: [
        {
          id: 'test-model',
          name: 'Test model',
          api: 'openai-completions',
          contextWindow: 8192,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
      enabled: true,
    };
    const created = await fetch(`${origin}/api/providers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(200);
    const saved = await fetch(`${origin}/api/providers/account/key`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: 'fake-key-private' }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain('fake-key-private');
    expect(
      (
        await fetch(`${origin}/api/providers/account`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...input, expectedRevision: 999 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(`${origin}/api/providers/account/key`, {
          method: 'DELETE',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(200);
    const response = await fetch(`${origin}/api/providers`, { headers });
    expect(await response.text()).toContain('"hasCredential":false');
  });
});
