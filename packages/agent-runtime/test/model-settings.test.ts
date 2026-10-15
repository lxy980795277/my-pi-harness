import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import {
  ProviderConfigSchema,
  ModelInfoSchema,
  type ProviderConfig,
  type ProviderInput,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore, openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { ModelGateway } from '../src/model-gateway.js';

function custom(): ProviderInput {
  return {
    id: 'local',
    name: 'Local',
    kind: 'custom',
    builtinId: null,
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:1/v1',
    models: [],
    enabled: true,
    requiresApiKey: false,
  };
}
function native(id: string, baseUrl: string | null = null): ProviderConfig {
  return {
    id,
    name: 'Old name',
    kind: 'builtin',
    builtinId: 'openai',
    api: null,
    baseUrl,
    models: [],
    enabled: true,
    requiresApiKey: true,
    credentialRef: `secret-${id}`,
    revision: 1,
    hasCredential: false,
    credentialType: null,
    legacy: false,
    configured: false,
    authSource: null,
    credentialPreview: null,
  };
}

describe('model settings ownership', () => {
  it('lists six selected native entries and keeps removed provider IDs resolvable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-native-slots-'));
    const store = await openProfileStore(directory);
    const secrets = createMemoryCredentialStore();
    store.putProvider(native('canonical'));
    store.putProvider(native('duplicate'));
    store.putProvider(native('old-proxy', 'https://proxy.invalid/v1'));
    store.bindBuiltinProvider('openai', 'canonical');
    const gateway = new ModelGateway({ store, secrets });
    try {
      await gateway.initialize();
      const configs = await gateway.listProviders();
      expect(configs).toHaveLength(6);
      expect(configs.map((config) => config.builtinId)).toEqual([
        'openai-codex',
        'anthropic',
        'google',
        'deepseek',
        'minimax',
        'kimi-coding',
      ]);
      expect(configs.map((config) => config.name)).toEqual([
        'OpenAI',
        'Anthropic',
        'Google',
        'DeepSeek',
        'MiniMax',
        'Kimi',
      ]);
      expect(new Set(configs.map((config) => config.builtinId)).size).toBe(6);
      expect((await gateway.getProvider('canonical')).legacy).toBe(true);
      const codex = configs[0];
      expect(codex?.models.every((model) => model.api === 'openai-codex-responses')).toBe(true);
      for (const config of configs) {
        expect([...Value.Errors(ProviderConfigSchema, config)]).toEqual([]);
        for (const model of await gateway.listModels(config.id))
          expect(Value.Check(ModelInfoSchema, model)).toBe(true);
      }
      expect(await gateway.getProvider('duplicate')).toMatchObject({
        id: 'duplicate',
        credentialRef: 'secret-duplicate',
        legacy: true,
      });
      expect(await gateway.getProvider('old-proxy')).toMatchObject({
        baseUrl: 'https://proxy.invalid/v1',
        legacy: true,
      });
      expect((await gateway.getProvider('canonical')).name).toBe('Old name');
      await expect(
        gateway.saveProvider({ ...custom(), kind: 'builtin', builtinId: 'openai', api: null }),
      ).rejects.toMatchObject({ code: 'PROVIDER_READ_ONLY' });
      await expect(gateway.deleteProvider('canonical')).rejects.toMatchObject({
        code: 'PROVIDER_READ_ONLY',
      });
      const canonical = await gateway.getProvider('canonical');
      expect(await gateway.setEnabled(canonical.id, false, canonical.revision)).toMatchObject({
        enabled: false,
      });
      expect(store.getProvider('duplicate')?.credentialRef).toBe('secret-duplicate');
    } finally {
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('saves empty custom settings, preserves advanced model fields and reloads defaults without changing old sessions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-default-model-'));
    let store = await openProfileStore(directory);
    const secrets = createMemoryCredentialStore();
    let gateway = new ModelGateway({ store, secrets });
    try {
      let config = await gateway.saveProvider(custom());
      expect(config).toMatchObject({ models: [], configured: true, authSource: 'none' });
      const model = {
        id: 'model',
        name: 'Model',
        api: 'openai-completions',
        contextWindow: 8192,
        maxTokens: 1024,
        reasoning: false,
        input: ['text'] as ('text' | 'image')[],
        headers: { 'X-Client': 'retained' },
        compat: { supportsStore: false },
      };
      config = await gateway.saveProvider({
        ...custom(),
        models: [model],
        expectedRevision: config.revision,
      });
      const { headers: _headers, compat: _compat, ...visible } = model;
      config = await gateway.saveProvider({
        ...custom(),
        models: [{ ...visible, name: 'Edited' }],
        expectedRevision: config.revision,
      });
      expect(config.models[0]).toMatchObject({
        headers: model.headers,
        compat: model.compat,
        name: 'Edited',
      });
      await expect(
        gateway.saveProvider({
          ...custom(),
          models: [model, model],
          expectedRevision: config.revision,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_CONFIG_INVALID' });
      await expect(
        gateway.saveProvider({ ...custom(), models: [], expectedRevision: 1 }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_CONFLICT',
      });
      config = await gateway.saveProvider({
        ...custom(),
        api: 'openai-responses',
        models: config.models,
        expectedRevision: config.revision,
      });
      expect(config.models[0]).toMatchObject({
        api: 'openai-responses',
        headers: model.headers,
        compat: model.compat,
      });
      expect((await gateway.listModels(config.id))[0]?.api).toBe('openai-responses');
      expect(() =>
        gateway.saveSettings({
          expectedRevision: 1,
          defaultModel: { providerId: config.id, modelId: 'model', thinkingLevel: 'high' },
        }),
      ).toThrow('Thinking');
      gateway.saveSettings({
        expectedRevision: 1,
        defaultModel: { providerId: config.id, modelId: 'model', thinkingLevel: 'off' },
      });
      const selected = await gateway.resolveSessionInput({ title: 'New' });
      store.createSession({ ...selected, id: 'existing', branchId: 'main', at: 1 });
      await gateway.close();
      store.close();
      store = await openProfileStore(directory);
      gateway = new ModelGateway({ store, secrets });
      await gateway.initialize();
      expect(await gateway.resolveSessionInput({ title: 'Restarted' })).toEqual({
        ...selected,
        title: 'Restarted',
      });
      expect(() => gateway.saveSettings({ expectedRevision: 1, defaultModel: null })).toThrow(
        'revision',
      );
      await gateway.setEnabled(config.id, false, config.revision);
      await expect(gateway.resolveSessionInput({ title: 'Unavailable' })).rejects.toMatchObject({
        code: 'PROVIDER_DISABLED',
      });
      expect(store.getSession('existing')).toMatchObject(selected);
      expect(gateway.getSettings().defaultModel?.providerId).toBe(config.id);
      gateway.saveSettings({ expectedRevision: 2, defaultModel: null });
      await expect(gateway.resolveSessionInput({ title: 'Unset' })).rejects.toMatchObject({
        code: 'DEFAULT_MODEL_REQUIRED',
      });
    } finally {
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
