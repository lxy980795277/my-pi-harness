import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { ModelDefinition, ProviderConfig } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore, openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { ModelGateway } from '../src/models/gateway';
import { createProviderInstance } from '../src/models/provider-instance';
import { loadBuiltinProvider } from '../src/models/providers';
import { SessionRuntime } from '../src/sessions/runtime';

const definition: ModelDefinition = {
  id: 'fixture-model',
  name: 'Fixture model',
  api: 'openai-completions',
  input: ['text'],
  reasoning: false,
  contextWindow: 8192,
  maxTokens: 1024,
};

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'fixture-account',
    name: 'Fixture account',
    kind: 'builtin',
    builtinId: 'openrouter',
    api: null,
    baseUrl: null,
    models: [],
    enabled: true,
    requiresApiKey: true,
    revision: 1,
    hasCredential: false,
    credentialType: null,
    legacy: false,
    configured: false,
    authSource: null,
    credentialPreview: null,
    ...overrides,
  };
}

function nativeFixture(): Provider<'openai-completions'> {
  const model: Model<'openai-completions'> = {
    ...definition,
    api: 'openai-completions',
    provider: 'openrouter',
    baseUrl: 'https://official.invalid/v1',
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return createProvider({
    id: 'openrouter',
    name: 'Fixture native provider',
    baseUrl: model.baseUrl,
    models: [model],
    api: openAICompletionsApi(),
    auth: { apiKey: envApiKeyAuth('Fixture key', []) },
  });
}

describe('Pi native catalog and account configuration', () => {
  it('uses the configured endpoint for model requests and Pi catalog refresh without mutating the native provider', async () => {
    const original = nativeFixture();
    const refreshEndpoints: (string | undefined)[] = [];
    const instance = await createProviderInstance(
      config({ baseUrl: 'https://proxy.invalid/v1' }),
      () =>
        Promise.resolve({
          ...original,
          refreshModels(context) {
            refreshEndpoints.push(context.baseUrl);
            return Promise.resolve();
          },
        }),
    );
    const models = createModels({
      authContext: {
        env: () => Promise.resolve(undefined),
        fileExists: () => Promise.resolve(false),
      },
    });
    try {
      models.setProvider(instance);
      expect(instance.baseUrl).toBe('https://proxy.invalid/v1');
      expect(instance.getModels()[0]).toMatchObject({
        provider: 'fixture-account',
        baseUrl: 'https://proxy.invalid/v1',
      });
      expect(await models.refresh({ allowNetwork: false })).toMatchObject({ aborted: false });
      expect(refreshEndpoints).toEqual(['https://proxy.invalid/v1']);
      expect(original.baseUrl).toBe('https://official.invalid/v1');
      expect(original.getModels()[0]).toMatchObject({
        provider: 'openrouter',
        baseUrl: 'https://official.invalid/v1',
      });
    } finally {
      models.clearProviders();
    }
  });

  it('uses the Pi 1.4 Kimi API and endpoint when a native account has no overrides', async () => {
    const account = config({ builtinId: 'kimi-coding' });
    const instance = await createProviderInstance(account, loadBuiltinProvider);
    expect(instance.baseUrl).toBe('https://api.kimi.com/coding/v1');
    expect(instance.getModels().length).toBeGreaterThan(0);
    for (const model of instance.getModels())
      expect(model).toMatchObject({
        api: 'openai-completions',
        provider: account.id,
        baseUrl: 'https://api.kimi.com/coding/v1',
      });
    expect(account.models).toEqual([]);
    expect(account.baseUrl).toBeNull();
  });

  it('rejects removed native models and stale API overrides instead of silently replacing their meaning', async () => {
    const invalid = [
      config({
        builtinId: 'kimi-coding',
        models: [{ ...definition, id: 'k3', api: 'anthropic-messages' }],
      }),
      config({
        builtinId: 'openai-codex',
        models: [{ ...definition, id: 'gpt-5.5', api: 'openai-codex-responses' }],
      }),
      config({ models: [{ ...definition, id: 'not-in-the-native-catalog' }] }),
    ];
    for (const account of invalid)
      await expect(createProviderInstance(account, loadBuiltinProvider)).rejects.toMatchObject({
        code: 'PROVIDER_CONFIG_INVALID',
      });
  });

  it('keeps an explicitly configured custom Kimi-compatible API and endpoint owned by its configuration', async () => {
    const account = config({
      kind: 'custom',
      builtinId: null,
      api: 'anthropic-messages',
      baseUrl: 'https://proxy.invalid/coding',
      models: [{ ...definition, api: 'anthropic-messages' }],
    });
    const instance = await createProviderInstance(account, loadBuiltinProvider);
    expect(instance.baseUrl).toBe(account.baseUrl);
    expect(instance.getModels()[0]).toMatchObject({
      id: definition.id,
      provider: account.id,
      api: 'anthropic-messages',
      baseUrl: account.baseUrl,
    });
  });

  it('refuses removed models and unsupported reasoning for new and existing sessions without changing the selection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-catalog-upgrade-'));
    const store = await openProfileStore(directory);
    const gateway = new ModelGateway({ store, secrets: createMemoryCredentialStore() });
    const errors: unknown[] = [];
    const runtime = new SessionRuntime({ store, gateway, onError: (error) => errors.push(error) });
    try {
      await gateway.initialize();
      const kimiId = store.getBuiltinProviderId('kimi-coding');
      const codexId = store.getBuiltinProviderId('openai-codex');
      if (!kimiId || !codexId) throw new Error('Missing native account');
      const settings = gateway.getSettings();
      expect(() =>
        gateway.saveSettings({
          expectedRevision: settings.revision,
          defaultModel: { providerId: codexId, modelId: 'gpt-5.5', thinkingLevel: 'off' },
        }),
      ).toThrow('Selected model is not configured');
      expect(() =>
        gateway.saveSettings({
          expectedRevision: settings.revision,
          defaultModel: { providerId: kimiId, modelId: 'k3', thinkingLevel: 'off' },
        }),
      ).toThrow('Thinking level is not supported');
      expect(gateway.getSettings()).toEqual(settings);

      await gateway.setApiKey(kimiId, 'fixture-kimi-key');
      const previousSelection = {
        providerId: kimiId,
        modelId: 'k3',
        thinkingLevel: 'off' as const,
      };
      store.createSession({
        id: 'existing-kimi-session',
        branchId: 'main',
        title: 'Existing Kimi selection',
        ...previousSelection,
        workspaceId: null,
        approvalMode: 'ask',
        at: 1,
      });
      await expect(
        runtime.send('existing-kimi-session', {
          mode: 'send',
          text: 'Do not send a request using an unsupported level.',
          requestId: 'unsupported-reasoning',
        }),
      ).rejects.toMatchObject({ code: 'MODEL_CAPABILITY' });
      expect(store.getSnapshot('existing-kimi-session').session).toMatchObject(previousSelection);
      expect(store.getSnapshot('existing-kimi-session').runs).toEqual([]);
      await expect(gateway.setApiKey(kimiId, 'fixture-replacement-key')).resolves.toBeDefined();
      expect(errors).toEqual([]);
    } finally {
      await runtime.close();
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
