import type { ModelInfo, ProviderConfig } from '@my-pi-harness/protocol';
import { getProviderAuthentication } from '../src/features/models/utils/provider-authentication';
import { describe, expect, it } from 'vitest';
import {
  buildAvailableModelOptions,
  buildThinkingOptions,
  findModelSelection,
  modelSelectionKey,
  providerToInput,
  resolveThinkingLevel,
} from '../src/features/models/utils/model-options';

const provider = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => {
  return {
    id: 'local',
    name: 'Local',
    kind: 'custom',
    builtinId: null,
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9999/v1',
    models: [
      {
        id: 'model',
        name: 'Model',
        api: 'openai-completions',
        contextWindow: 128000,
        maxTokens: 32000,
        reasoning: true,
        input: ['text'],
        compat: { supportsStore: false },
        headers: { 'X-Project': 'learning' },
      },
    ],
    enabled: true,
    requiresApiKey: false,
    legacy: false,
    configured: true,
    authSource: 'none',
    credentialPreview: null,
    credentialRef: 'opaque-reference',
    revision: 2,
    hasCredential: false,
    credentialType: null,
    ...overrides,
  };
};

const model: ModelInfo = {
  id: 'reasoning',
  name: 'Reasoning',
  api: 'openai-responses',
  contextWindow: 128000,
  maxTokens: 32000,
  reasoning: true,
  input: ['text'],
  supportedThinkingLevels: ['off', 'low', 'high'],
};

describe('explicit model selection', () => {
  it('offers only OAuth for a native OAuth-only provider and API Key for a custom service', () => {
    const native = provider({ kind: 'builtin', builtinId: 'openai-codex' });
    expect(
      getProviderAuthentication(native, {
        id: 'openai-codex',
        name: 'OpenAI Codex',
        authKinds: ['oauth'],
      }),
    ).toEqual({ supportsApiKey: false, supportsOAuth: true, initialMethod: 'oauth' });
    expect(getProviderAuthentication(provider(), undefined)).toEqual({
      supportsApiKey: true,
      supportsOAuth: false,
      initialMethod: 'api_key',
    });
  });
  it('keeps a missing, disabled or unconfigured saved selection invalid instead of choosing another provider', () => {
    const saved = modelSelectionKey('saved', 'model');
    const alternative = provider({ id: 'alternative' });
    expect(findModelSelection([alternative], saved)).toBeNull();
    expect(
      findModelSelection([alternative, provider({ id: 'saved', enabled: false })], saved),
    ).toBeNull();
    expect(
      findModelSelection([alternative, provider({ id: 'saved', configured: false })], saved),
    ).toBeNull();
    expect(buildAvailableModelOptions([alternative, provider({ configured: false })])).toEqual([
      { value: modelSelectionKey('alternative', 'model'), label: 'Local · Model' },
    ]);
  });

  it('distinguishes provider and model ids containing selection delimiters', () => {
    const first = provider({ id: 'a:b', models: [{ ...model, id: 'c' }] });
    const second = provider({ id: 'a', models: [{ ...model, id: 'b:c' }] });
    const options = buildAvailableModelOptions([first, second]);
    expect(options[0]?.value).not.toBe(options[1]?.value);
    expect(findModelSelection([first, second], modelSelectionKey('a', 'b:c'))).toEqual({
      providerId: 'a',
      modelId: 'b:c',
      thinkingLevel: 'off',
    });
  });

  it('offers only capabilities declared for the selected model', () => {
    expect(
      buildThinkingOptions(model).map((option) => {
        return option.value;
      }),
    ).toEqual(['off', 'low', 'high']);
    expect(resolveThinkingLevel('high', model)).toBe('high');
    expect(resolveThinkingLevel('max', model)).toBe('off');
    expect(buildThinkingOptions(undefined)).toEqual([{ value: 'off', label: '关闭' }]);
  });

  it('preserves advanced model fields and optimistic revision while editing provider metadata', () => {
    const current = provider();
    const input = providerToInput(current);
    expect(input.models[0]?.headers).toEqual({ 'X-Project': 'learning' });
    expect(input.models[0]?.compat).toEqual({ supportsStore: false });
    expect(input.expectedRevision).toBe(2);
    expect(input).not.toHaveProperty('credentialRef');
    expect(input).not.toHaveProperty('credentialPreview');
    expect(input.requiresApiKey).toBe(false);
  });
});
