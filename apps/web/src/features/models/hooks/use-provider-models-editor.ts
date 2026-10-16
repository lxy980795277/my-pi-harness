import type { ProviderModelsEditorState } from '@/features/models/types/model';
import type { ConnectionResult, ModelDefinition, ProviderConfig } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useProviderModels } from '@/features/models/hooks/use-model-catalog';
import { saveProvider, testProvider } from '@/features/models/services/providers';
import { providerToInput } from '@/features/models/utils/model-options';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** A model list is saved atomically while untouched advanced fields stay attached to their model. */
export const useProviderModelsEditor = (provider: ProviderConfig): ProviderModelsEditorState => {
  const client = useQueryClient();
  const close = useWorkspaceStore((state) => {
    return state.closeModels;
  });
  const query = useProviderModels(provider.id, provider.revision);
  const [draftBase] = useState(provider);
  const [draft, setDraft] = useState<ModelDefinition[]>(provider.models);
  const [newId, setNewId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ConnectionResult>>({});
  const custom = provider.kind === 'custom';
  let models: ModelDefinition[] = draft;
  if (!custom) {
    models = query.data ?? provider.models;
  }
  const update = useCallback((model: ModelDefinition): void => {
    setDraft((current) => {
      return current.map((item) => {
        if (item.id === model.id) {
          return model;
        }
        return item;
      });
    });
  }, []);
  const remove = useCallback((id: string): void => {
    setDraft((current) => {
      return current.filter((model) => {
        return model.id !== id;
      });
    });
  }, []);
  const changeNewId = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setNewId(event.target.value);
  }, []);
  const add = useCallback((): void => {
    const id = newId.trim();
    if (
      id.length === 0 ||
      draft.some((model) => {
        return model.id === id;
      })
    ) {
      setValidationError('请输入尚未添加的模型 ID。');
      return;
    }
    if (draft.length >= 100) {
      setValidationError('每个自定义 Provider 最多配置 100 个模型。');
      return;
    }
    setDraft((current) => {
      return [
        ...current,
        {
          id,
          name: id,
          api: draftBase.api ?? 'openai-responses',
          contextWindow: 128000,
          maxTokens: 32000,
          reasoning: false,
          input: ['text'],
        },
      ];
    });
    setNewId('');
    setValidationError(null);
  }, [draft, newId, draftBase.api]);
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await saveProvider({ ...providerToInput(draftBase), models: draft }, signal);
        await Promise.all([
          client.invalidateQueries({ queryKey: ['providers'] }),
          client.invalidateQueries({ queryKey: ['provider-models', provider.id] }),
        ]);
        signal.throwIfAborted();
        close();
      },
      [client, close, draft, draftBase, provider.id],
    ),
  );
  const { run: saveRun } = save;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      saveRun();
    },
    [saveRun],
  );
  const test = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, id: string): Promise<void> => {
        const result = await testProvider(provider.id, id, signal);
        signal.throwIfAborted();
        setResults((current) => {
          return { ...current, [id]: result };
        });
      },
      [provider.id],
    ),
  );
  const persistedIds = new Set(
    draftBase.models.map((model) => {
      return model.id;
    }),
  );
  let error = validationError;
  if (error === null) {
    error = save.error;
  }
  if (error === null) {
    error = test.error;
  }
  if (error === null && query.error !== null) {
    error = query.error.message;
  }
  return {
    models,
    custom,
    newId,
    changeNewId,
    add,
    update,
    remove,
    submit,
    close,
    pending: save.pending,
    test: test.run,
    testing: test.pending,
    persistedIds,
    results,
    error: error,
  };
};
