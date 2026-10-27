import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  BUILTIN_PLUGINS,
  PluginError,
  BUILTIN_PLUGIN_APPS,
  CONNECTION_PROVIDERS,
  loadBuiltinPluginApps,
  parseBuiltinPluginApps,
  type BuiltinPluginApp,
} from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const APP: BuiltinPluginApp = {
  id: 'github',
  provider: 'github',
  name: 'GitHub',
  description: 'Fixture repository integration',
  credentialSource: 'plugin-oauth',
  transport: 'streamable-http',
  endpoint: 'https://api.githubcopilot.com/mcp/',
};

it('loads private MCP targets and public metadata from the same declarative App resources', () => {
  expect(BUILTIN_PLUGIN_APPS).toHaveLength(9);
  for (const plugin of BUILTIN_PLUGINS) {
    const apps = loadBuiltinPluginApps(plugin.id);
    expect(apps.map((app) => app.id)).toEqual(plugin.apps.map((app) => app.id));
    for (const app of apps)
      expect(plugin.apps.find((publicApp) => publicApp.id === app.id)).toEqual({
        id: app.id,
        provider: app.provider,
        name: app.name,
        description: app.description,
        credentialSource: app.credentialSource,
      });
    expect(JSON.stringify(plugin)).not.toContain('endpoint');
  }
  expect(BUILTIN_PLUGIN_APPS.find((app) => app.id === 'github')).toMatchObject({
    pluginId: 'github',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    credentialSource: 'plugin-oauth',
  });
  expect(BUILTIN_PLUGIN_APPS.filter((app) => app.pluginId === 'google')).toHaveLength(5);
  for (const provider of CONNECTION_PROVIDERS) {
    const apps = BUILTIN_PLUGIN_APPS.filter((app) => app.provider === provider.serviceId);
    expect(apps.length).toBeGreaterThan(0);
    expect(provider.mcpEndpoints).toEqual(apps.map((app) => app.endpoint));
    expect(provider.apps).toEqual(apps.map((app) => app.name));
  }
  expect(
    parseBuiltinPluginApps(JSON.stringify({ apps: [{ ...APP, transport: 'sse' }] }), 'github')[0]
      ?.transport,
  ).toBe('sse');
});

it.each([
  (app: BuiltinPluginApp) => ({ ...app, command: 'forbidden' }),
  (app: BuiltinPluginApp) => ({ ...app, headers: { Authorization: 'private-value' } }),
  (app: BuiltinPluginApp) => ({ ...app, clientSecret: 'private-value' }),
  (app: BuiltinPluginApp) => ({ ...app, provider: 'google' }),
  (app: BuiltinPluginApp) => ({ ...app, id: 'google-docs' }),
  (app: BuiltinPluginApp) => ({ ...app, credentialSource: undefined }),
  (app: BuiltinPluginApp) => ({ ...app, transport: 'stdio' }),
  (app: BuiltinPluginApp) => ({ ...app, endpoint: 'http://api.githubcopilot.com/mcp/' }),
  (app: BuiltinPluginApp) => ({ ...app, endpoint: 'https://127.0.0.1/mcp/' }),
  (app: BuiltinPluginApp) => ({ ...app, endpoint: 'https://localhost/mcp/' }),
  (app: BuiltinPluginApp) => ({
    ...app,
    endpoint: 'https://private-value@api.githubcopilot.com/mcp/',
  }),
  (app: BuiltinPluginApp) => ({
    ...app,
    endpoint: 'https://api.githubcopilot.com/mcp/?token=private-value',
  }),
])('rejects undeclared behavior, credential data, wrong owners and unsafe targets', (change) => {
  expect(() => parseBuiltinPluginApps(JSON.stringify({ apps: [change(APP)] }), 'github')).toThrow(
    '应用声明无效',
  );
});

it('rejects duplicate IDs, extra root fields, traversal, oversized or malformed declarations', () => {
  for (const source of [
    JSON.stringify({ apps: [APP, APP] }),
    JSON.stringify({ apps: [APP], execute: true }),
    '{}',
    '{',
    ' '.repeat(65537),
  ])
    expect(() => parseBuiltinPluginApps(source, 'github')).toThrow('应用声明无效');
  expect(() => loadBuiltinPluginApps('../github')).toThrow('应用声明无效');
  expect(() => loadBuiltinPluginApps('../github')).toThrow(PluginError);
});

it('refuses linked, invalid UTF-8 and oversized resource files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-app-resources-'));
  roots.push(directory);
  const github = join(directory, 'github');
  await mkdir(github);
  const source = join(directory, 'source.json');
  const target = join(github, '.app.json');
  await writeFile(source, JSON.stringify({ apps: [APP] }));
  await symlink(source, target);
  expect(() => loadBuiltinPluginApps('github', directory)).toThrow('应用声明无效');
  await rm(target);
  await writeFile(target, Buffer.from([0xff]));
  expect(() => loadBuiltinPluginApps('github', directory)).toThrow('应用声明无效');
  await writeFile(target, ' '.repeat(65537));
  expect(() => loadBuiltinPluginApps('github', directory)).toThrow('应用声明无效');
});
