import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openProfileStore } from '../src/index.js';

describe('SQLite-owned application settings', () => {
  it('creates explicit defaults and preserves changed defaults across session projection rebuilds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-model-settings-'));
    let store = await openProfileStore(directory);
    try {
      expect(store.getSettings()).toEqual({ revision: 1, defaultModel: null });
      store.putSettings({
        expectedRevision: 1,
        defaultModel: {
          providerId: 'provider',
          modelId: 'model',
          thinkingLevel: 'off',
        },
      });
      expect(() => store.putSettings({ expectedRevision: 1, defaultModel: null })).toThrow(
        'revision',
      );
      store.close();
      store = await openProfileStore(directory);
      expect(store.getSettings()).toMatchObject({
        revision: 2,
        defaultModel: { providerId: 'provider' },
      });
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
