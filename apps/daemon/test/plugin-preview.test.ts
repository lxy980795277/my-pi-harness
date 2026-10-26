import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Value } from 'typebox/value';
import { PluginDetailSchema, type PluginDetail } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { loadDaemonConfig } from '../src/config.js';
import { createApplicationServices } from '../src/services.js';
import { createDaemonApplication } from '../src/server.js';
import { loginFixture } from './support/login.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-preview-api-'));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const profile = join(directory, 'profile');
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const credentials = createMemoryCredentialStore();
  const services = await createApplicationServices(config, { credentials });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  cleanups.push(async () => await application.server.close());
  const identity = await loginFixture(origin, services);
  const get = async (path: string): Promise<Response> =>
    await fetch(`${origin}${path}`, {
      headers: { Cookie: identity.cookie, Origin: origin },
      signal: AbortSignal.timeout(5000),
    });
  const detail = async (id: string): Promise<PluginDetail> => {
    const response = await get(`/api/plugins/${encodeURIComponent(id)}`);
    const data: unknown = await response.json();
    if (!response.ok || !Value.Check(PluginDetailSchema, data))
      throw new Error('Invalid plugin preview');
    return data;
  };
  return { services, credentials, origin, get, detail, profile };
}

it('previews every uninstalled bundled plugin through protected HTTP without creating configuration or snapshots', async () => {
  const f = await fixture();
  const unauthenticated = await fetch(`${f.origin}/api/plugins/github`, {
    signal: AbortSignal.timeout(5000),
  });
  expect(unauthenticated.status).toBe(401);
  const before = await readdir(f.profile, { recursive: true });
  const credentials = vi.spyOn(f.credentials, 'read');
  const freeze = vi.spyOn(f.services.skills, 'freezeSelections');
  for (const plugin of f.services.plugins.list()) {
    const detail = await f.detail(plugin.manifest.id);
    expect(detail.plugin).toEqual(plugin);
    expect(detail.skills.map((skill) => skill.name)).toEqual(plugin.manifest.skills);
    expect(detail.skills[0]?.content.length).toBeGreaterThan(100);
    expect(JSON.stringify(detail)).not.toContain(f.profile);
  }
  expect(f.services.store.extensions.plugins()).toEqual([]);
  expect(f.services.store.extensions.skills()).toEqual([]);
  expect(f.services.remoteMcp.list()).toEqual([]);
  expect(f.services.store.listSessions()).toEqual([]);
  expect(await readdir(f.profile, { recursive: true })).toEqual(before);
  expect(credentials).not.toHaveBeenCalled();
  expect(freeze).not.toHaveBeenCalled();
});

it('keeps installed component preferences and Markdown available when the plugin is disabled', async () => {
  const f = await fixture();
  const preview = await f.detail('google');
  const installed = await f.services.plugins.install('google', new AbortController().signal);
  const changed = await f.services.plugins.component(
    'google',
    'skill:google',
    installed.revision,
    false,
  );
  const disabled = await f.services.plugins.control('google', changed.revision, false);
  const before = await readdir(f.profile, { recursive: true });
  const detail = await f.detail('google');
  expect(detail.plugin).toEqual(disabled);
  expect(detail.skills).toEqual(preview.skills);
  expect(
    detail.plugin.components.find((component) => component.id === 'skill:google')?.enabled,
  ).toBe(false);
  expect(detail.plugin.manifest.apps).toHaveLength(5);
  expect(await f.services.skills.list(null, new AbortController().signal)).toEqual([]);
  expect(await readdir(f.profile, { recursive: true })).toEqual(before);
});

it('rejects unknown plugin IDs, client-selected paths and reads after service closure', async () => {
  const f = await fixture();
  expect((await f.get('/api/plugins/unknown-plugin')).status).toBe(404);
  expect((await f.get('/api/plugins/github?path=SKILL.md')).status).toBe(400);
  expect((await f.get('/api/plugins/github?workspaceId=project')).status).toBe(400);
  f.services.plugins.stopAccepting();
  expect((await f.get('/api/plugins/github')).status).toBe(409);
});
