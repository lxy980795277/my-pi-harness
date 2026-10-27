import { expect, it } from 'vitest';
import {
  BUILTIN_PLUGINS,
  PLUGIN_CONNECTION_DEFINITIONS,
  parsePluginConnectionManifest,
  pluginConnectionDefinition,
  type PluginConnectionDefinition,
} from '../src/index.js';

it('loads all five host manifests and keeps clients and OAuth metadata outside the public plugin catalog', () => {
  expect(PLUGIN_CONNECTION_DEFINITIONS).toHaveLength(5);
  expect(PLUGIN_CONNECTION_DEFINITIONS.map(({ id, oauth }) => [id, oauth.issuer])).toEqual([
    ['github', 'https://github.com/login/oauth'],
    ['google', 'https://accounts.google.com'],
    ['vercel', 'https://vercel.com'],
    ['notion', 'https://api.notion.com'],
    ['supabase', 'https://api.supabase.com'],
  ]);
  expect(pluginConnectionDefinition('github').oauth.scopes).toEqual(['repo', 'user']);
  const manifest = structuredClone(pluginConnectionDefinition('github'));
  manifest.oauth.clientId = 'fixture-manifest-client';
  manifest.oauth.clientSecret = 'fixture-manifest-secret';
  expect(parsePluginConnectionManifest(JSON.stringify(manifest), 'github').oauth.clientSecret).toBe(
    'fixture-manifest-secret',
  );
  const publicPlugins = JSON.stringify(BUILTIN_PLUGINS);
  expect(publicPlugins).not.toContain('clientSecret');
  expect(publicPlugins).not.toContain('fixture-manifest-secret');
  expect(publicPlugins).not.toContain('authorizationEndpoint');
});

it.each([
  undefined,
  'http://github.com/login/oauth',
  'https://fixture-secret@github.com/login/oauth',
  'https://github.com/login/oauth?issuer=untrusted',
  'https://github.com/login/oauth#untrusted',
  'https://127.0.0.1/login/oauth',
])('rejects a missing or invalid issuer %j from host manifests', (issuer) => {
  const manifest = structuredClone(pluginConnectionDefinition('github'));
  expect(() =>
    parsePluginConnectionManifest(
      JSON.stringify({ ...manifest, oauth: { ...manifest.oauth, issuer } }),
      'github',
    ),
  ).toThrow('配置无效');
});

it.each([
  (value: PluginConnectionDefinition) => ({
    ...value,
    executable: 'forbidden',
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    id: 'other-plugin',
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    apiUrl: 'https://127.0.0.1',
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    oauth: { ...value.oauth, tokenEndpoint: 'http://untrusted.example/token' },
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    gateway: { ...value.gateway, allowedPaths: ['['] },
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    gateway: { ...value.gateway, headers: { Authorization: 'Bearer forbidden' } },
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    oauth: { ...value.oauth, authorizationParams: { redirect_uri: 'https://untrusted.example' } },
  }),
  (value: PluginConnectionDefinition) => ({
    ...value,
    oauth: { ...value.oauth, callbackUrl: 'http://127.0.0.1/api/auth/callback/github' },
  }),
])(
  'rejects unknown, cross-plugin, private or authority-overriding host manifest data',
  (change) => {
    expect(() =>
      parsePluginConnectionManifest(
        JSON.stringify(change(structuredClone(pluginConnectionDefinition('github')))),
        'github',
      ),
    ).toThrow('配置无效');
  },
);

it.each(['id: github\nid: github\n', 'id: &id github\nname: *id\n', '!!js/function function() {}'])(
  'rejects ambiguous or executable YAML %j',
  (source) => {
    expect(() => parsePluginConnectionManifest(source, 'github')).toThrow('配置无效');
  },
);
