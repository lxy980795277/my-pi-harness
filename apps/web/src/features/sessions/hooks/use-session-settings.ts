import type { SessionSettingsState } from '@/features/sessions/types/session-view';
import type {
  ModelInfo,
  ProviderConfig,
  SessionPatchInput,
  SessionSummary,
  ThinkingLevel,
} from '@my-pi-harness/protocol';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { fetchProvider } from '@/features/models/services/providers';
import { useProviderModels } from '@/features/models/hooks/use-model-catalog';
import { buildThinkingOptions, resolveThinkingLevel } from '@/features/models/utils/model-options';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Legacy session ids resolve explicitly and remain selected until the owner changes the picker. */
export const useSessionSettings = (
  session: SessionSummary,
  providers: ProviderConfig[],
  onPatch: (input: SessionPatchInput) => Promise<void>,
): SessionSettingsState => {
  const [title, setTitle] = useState(session.title);
  const [providerId, setProviderId] = useState(session.providerId);
  const [modelId, setModelId] = useState(session.modelId);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(session.thinkingLevel);
  const canonical = providers.find((item) => {
    return item.id === providerId;
  });
  const legacy = useQuery({
    queryKey: ['provider', providerId],
    queryFn: ({ signal }): Promise<ProviderConfig> => {
      return fetchProvider(providerId, signal);
    },
    enabled: canonical === undefined && providerId.length > 0,
  });
  const provider = canonical ?? legacy.data;
  const models = useProviderModels(providerId, provider?.revision, provider !== undefined);
  const selectedModel: ModelInfo | undefined = models.data?.find((item) => {
    return item.id === modelId;
  });
  const save = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await onPatch({ title: title.trim(), providerId, modelId, thinkingLevel });
    }, [modelId, onPatch, providerId, thinkingLevel, title]),
  );
  const { run: saveRun } = save;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      saveRun();
    },
    [saveRun],
  );
  const changeTitle = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
  }, []);
  const changeProvider = useCallback((value: string): void => {
    setProviderId(value);
    setModelId('');
    setThinkingLevel('off');
  }, []);
  const changeModel = useCallback((value: string): void => {
    setModelId(value);
    setThinkingLevel('off');
  }, []);
  const changeThinking = useCallback(
    (value: string): void => {
      setThinkingLevel(resolveThinkingLevel(value, selectedModel));
    },
    [selectedModel],
  );
  const available = [...providers];
  if (provider?.legacy && !canonical) {
    available.push(provider);
  }
  const providerOptions = available.map((item) => {
    let label = item.name;
    if (item.legacy) {
      label = `${item.name}（历史配置）`;
    }
    return { value: item.id, label, disabled: !item.enabled };
  });
  const modelOptions =
    models.data?.map((item) => {
      return { value: item.id, label: item.name };
    }) ?? [];
  return {
    title,
    providerId,
    modelId,
    thinkingLevel,
    providerOptions,
    modelOptions,
    thinkingOptions: buildThinkingOptions(selectedModel),
    changeTitle,
    changeProvider,
    changeModel,
    changeThinking,
    submit,
    pending: save.pending,
    modelsReady: models.isSuccess,
    legacy: provider?.legacy === true,
    disabled: save.pending || modelId.length === 0 || !provider?.enabled,
    error: save.error ?? models.error?.message ?? legacy.error?.message ?? null,
  };
};
