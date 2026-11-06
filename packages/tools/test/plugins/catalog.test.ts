import { expect, it } from 'vitest';
import { PluginCatalog, parsePluginManifest } from '../../src/plugins/index.js';

it('indexes contributions without storing installation or authorization state', () => {
  const catalog = new PluginCatalog();
  const original = catalog.get('documents');
  const changed = catalog.get('documents');
  changed.skills.push('other');
  expect(catalog.get('documents')).toEqual(original);
  expect(catalog.contributions('documents')).toEqual([
    { pluginId: 'documents', kind: 'skill', id: 'skill:documents', referenceId: 'documents' },
  ]);
  expect(catalog.skillRoot('documents')).toMatchObject({
    pluginId: 'documents',
    scope: 'plugin',
    workspaceId: null,
  });
  expect(catalog.get('documents')).not.toHaveProperty('enabled');
  expect(() => catalog.get('missing')).toThrow('Unknown plugin');
});

it('rejects duplicate ownership and executable or credential metadata', () => {
  const catalog = new PluginCatalog();
  const manifest = catalog.get('documents');
  expect(() => new PluginCatalog([manifest, manifest])).toThrow('duplicated');
  expect(() =>
    parsePluginManifest(JSON.stringify({ ...manifest, skills: ['documents', 'documents'] })),
  ).toThrow('duplicate');
  expect(() => parsePluginManifest(JSON.stringify({ ...manifest, execute: 'forbidden' }))).toThrow(
    'invalid',
  );
  expect(() =>
    parsePluginManifest(JSON.stringify({ ...manifest, clientSecret: 'fixture-secret' })),
  ).toThrow('invalid');
  expect(parsePluginManifest(JSON.stringify(manifest))).toEqual(manifest);
});
