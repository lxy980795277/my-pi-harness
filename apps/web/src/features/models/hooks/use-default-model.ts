import type { DefaultModelState } from '@/features/models/types/model-view';
import type { DefaultModel } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useModelCatalog, useProviderModels } from '@/features/models/hooks/use-model-catalog';
import { saveAppSettings } from '@/features/models/services/providers';
import {
  buildAvailableModelOptions,
  buildThinkingOptions,
  findModelSelection,
  modelSelectionKey,
  resolveThinkingLevel,
} from '@/features/models/utils/model-options';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Each picker change persists an explicit, revision-checked application default. */
export const useDefaultModel = (): DefaultModelState => {
  const catalog = useModelCatalog();
  const client = useQueryClient();
  const providers = useMemo(() => {
    return catalog.providers.data ?? [];
  }, [catalog.providers.data]);
  const selection = catalog.settings.data?.defaultModel ?? null;
  const currentProvider = providers.find((provider) => {
    return provider.id === selection?.providerId;
  });
  const models = useProviderModels(currentProvider?.id ?? '', currentProvider?.revision);
  const model = models.data?.find((item) => {
    return item.id === selection?.modelId;
  });
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, defaultModel: DefaultModel): Promise<void> => {
        if (!catalog.settings.data) {
          throw new Error('全局设置尚未读取完成。');
        }
        const updated = await saveAppSettings(
          { expectedRevision: catalog.settings.data.revision, defaultModel },
          signal,
        );
        client.setQueryData(['app-settings'], updated);
      },
      [catalog.settings.data, client],
    ),
  );
  const { run: saveRun } = save;
  const changeModel = useCallback(
    (key: string): void => {
      const next = findModelSelection(providers, key);
      if (next) {
        saveRun(next);
      }
    },
    [providers, saveRun],
  );
  const changeThinking = useCallback(
    (value: string): void => {
      if (selection && model) {
        saveRun({ ...selection, thinkingLevel: resolveThinkingLevel(value, model) });
      }
    },
    [model, saveRun, selection],
  );
  let selectedKey = '';
  let invalid = false;
  if (selection) {
    selectedKey = modelSelectionKey(selection.providerId, selection.modelId);
    invalid = findModelSelection(providers, selectedKey) === null;
  }
  return {
    options: buildAvailableModelOptions(providers),
    selectedKey,
    thinking: selection?.thinkingLevel ?? 'off',
    thinkingOptions: buildThinkingOptions(model),
    changeModel,
    changeThinking,
    invalid,
    pending: save.pending || catalog.settings.isPending,
    error: save.error ?? catalog.settings.error?.message ?? models.error?.message ?? null,
  };
};
