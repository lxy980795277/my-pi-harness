import type {
  DefaultModel,
  ModelInfo,
  ProviderConfig,
  ProviderInput,
  ThinkingLevel,
} from '@my-pi-harness/protocol';

import type { SelectOption } from '@/components/ui/select-field';

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '更高',
  max: '最大',
};

/** UI selection keys encode both ids without assigning account meaning to separators. */
export const modelSelectionKey = (providerId: string, modelId: string): string => {
  return `${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;
};

/** Only explicitly configured, enabled endpoints are offered for new conversations. */
export const buildAvailableModelOptions = (
  providers: readonly ProviderConfig[],
): SelectOption[] => {
  return providers
    .filter((provider) => {
      return provider.enabled && provider.configured;
    })
    .flatMap((provider) => {
      return provider.models.map((model) => {
        return {
          value: modelSelectionKey(provider.id, model.id),
          label: `${provider.name} · ${model.name}`,
        };
      });
    });
};

/** Resolves a selected key against the current catalog rather than parsing untrusted ids. */
export const findModelSelection = (
  providers: readonly ProviderConfig[],
  key: string,
): DefaultModel | null => {
  for (const provider of providers) {
    if (!provider.enabled || !provider.configured) {
      continue;
    }
    for (const model of provider.models) {
      if (modelSelectionKey(provider.id, model.id) === key) {
        return { providerId: provider.id, modelId: model.id, thinkingLevel: 'off' };
      }
    }
  }
  return null;
};

/** Copies public editable fields while preserving stored advanced model definitions. */
export const providerToInput = (provider: ProviderConfig): ProviderInput => {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    builtinId: provider.builtinId,
    api: provider.api,
    baseUrl: provider.baseUrl,
    models: provider.models,
    enabled: provider.enabled,
    requiresApiKey: provider.requiresApiKey,
    expectedRevision: provider.revision,
  };
};

/** Model-specific thinking options prevent unsupported global enum values from being selected. */
export const buildThinkingOptions = (model: ModelInfo | undefined): SelectOption[] => {
  if (!model) {
    return [{ value: 'off', label: THINKING_LABELS.off }];
  }
  return model.supportedThinkingLevels.map((level) => {
    return { value: level, label: THINKING_LABELS[level] };
  });
};

/** A select event is accepted only when it matches a supported level. */
export const resolveThinkingLevel = (
  value: string,
  model: ModelInfo | undefined,
): ThinkingLevel => {
  if (model) {
    for (const level of model.supportedThinkingLevels) {
      if (level === value) {
        return level;
      }
    }
  }
  return 'off';
};
