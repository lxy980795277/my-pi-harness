import { expect, it } from 'vitest';
import { PluginCatalog } from '../../src/plugins/index.js';

it('returns independent public metadata', () => {
  const catalog = new PluginCatalog();
  const original = catalog.get('documents');
  const changed = catalog.get('documents');
  changed.skills.push('other');
  expect(catalog.get('documents')).toEqual(original);
  expect(catalog.get('documents')).not.toHaveProperty('enabled');
  expect(() => catalog.get('missing')).toThrow('Unknown plugin');
});

it('rejects duplicate plugin and contribution identifiers', () => {
  const catalog = new PluginCatalog();
  const manifest = catalog.get('documents');
  expect(() => new PluginCatalog([manifest, manifest])).toThrow('duplicated');
  expect(() => new PluginCatalog([{ ...manifest, skills: ['documents', 'documents'] }])).toThrow(
    'duplicate',
  );
});
