import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThinkingLevel } from '@my-pi-harness/protocol';
import { useCallback, useState, type SubmitEvent } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import { useArchiveAccess } from '@/features/archives/hooks/use-archive-access';
import { bindImportedSession } from '@/features/archives/services/archive-access';
import { useArchiveStore } from '@/features/archives/stores/archives';
import { PROVIDERS_QUERY_OPTIONS } from '@/features/models/queries/catalog';
import {
  buildAvailableModelOptions,
  buildThinkingOptions,
  findModelSelection,
} from '@/features/models/utils/model-options';
import { useProviderModels } from '@/features/models/hooks/use-model-catalog';
import { archiveBindingThinking } from '@/features/archives/utils/archive-binding';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { useNavigationStore } from '@/app/stores/navigation';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface ArchiveBindingState {
  access: ReturnType<typeof useArchiveAccess>;
  modelKey: string;
  workspaceKey: string;
  modelOptions: SelectOption[];
  workspaceOptions: SelectOption[];
  thinking: string;
  thinkingOptions: SelectOption[];
  changeThinking: (value: string) => void;
  changeModel: (value: string) => void;
  changeWorkspace: (value: string) => void;
  submit: (event: SubmitEvent<HTMLFormElement>) => void;
  read: () => void;
  refresh: () => void;
  pending: boolean;
  disabled: boolean;
  error: string | null;
}

/** Current dependencies require explicit choices; imported configuration never supplies defaults. */
export const useArchiveBinding = (sessionId: string): ArchiveBindingState => {
  const client = useQueryClient();
  const providers = useQuery(PROVIDERS_QUERY_OPTIONS);
  const workspaces = useWorkspaces();
  const access = useArchiveAccess(sessionId);
  const close = useArchiveStore((state) => {
    return state.close;
  });
  const select = useNavigationStore((state) => {
    return state.selectSession;
  });
  const [modelKey, setModelKey] = useState('');
  const [workspaceKey, setWorkspaceKey] = useState('');
  const [preferredThinking, setPreferredThinking] = useState<ThinkingLevel | null>(null);
  const selectedModel = findModelSelection(providers.data ?? [], modelKey);
  const provider = providers.data?.find((item) => {
    return item.id === selectedModel?.providerId;
  });
  const capabilities = useProviderModels(
    provider?.id ?? '',
    provider?.revision,
    provider !== undefined,
  );
  const modelInfo = capabilities.data?.find((item) => {
    return item.id === selectedModel?.modelId;
  });
  const thinking = archiveBindingThinking(modelInfo, preferredThinking);
  let thinkingOptions: SelectOption[] = [];
  if (modelInfo !== undefined) thinkingOptions = buildThinkingOptions(modelInfo);
  const changeModel = useCallback((value: string): void => {
    setModelKey(value);
    setPreferredThinking(null);
  }, []);
  const changeThinking = useCallback(
    (value: string): void => {
      for (const level of modelInfo?.supportedThinkingLevels ?? [])
        if (level === value) {
          setPreferredThinking(level);
          return;
        }
    },
    [modelInfo],
  );
  const models = buildAvailableModelOptions(providers.data ?? []);
  const workspaceOptions: SelectOption[] = [
    { value: 'none', label: '不使用工作区' },
    ...(workspaces.data ?? []).map((workspace) => {
      return { value: workspace.id, label: workspace.name };
    }),
  ];
  const binding = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const model = findModelSelection(providers.data ?? [], modelKey);
        if (model === null || workspaceKey.length === 0 || thinking === null)
          throw new Error('请选择当前模型与工作区。');
        let workspaceId: string | null = null;
        if (workspaceKey !== 'none') {
          const workspace = workspaces.data?.find((item) => {
            return item.id === workspaceKey;
          });
          if (workspace === undefined) throw new Error('所选工作区已不可用，请重新选择。');
          workspaceId = workspace.id;
        }
        await bindImportedSession(
          sessionId,
          {
            providerId: model.providerId,
            modelId: model.modelId,
            thinkingLevel: thinking,
            workspaceId,
          },
          signal,
        );
        signal.throwIfAborted();
        await Promise.all([
          client.invalidateQueries({ queryKey: ['archive-access', sessionId] }),
          client.invalidateQueries({ queryKey: ['session', sessionId] }),
          client.invalidateQueries({ queryKey: ['sessions'] }),
        ]);
        signal.throwIfAborted();
        select(sessionId);
        close();
      },
      [
        client,
        close,
        modelKey,
        providers.data,
        select,
        sessionId,
        thinking,
        workspaceKey,
        workspaces.data,
      ],
    ),
  );
  const runBind = binding.run;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      runBind();
    },
    [runBind],
  );
  const read = useCallback((): void => {
    select(sessionId);
    close();
  }, [close, select, sessionId]);
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await Promise.all([providers.refetch(), workspaces.refetch(), access.refetch()]);
      if (provider !== undefined) await capabilities.refetch();
    }, [access, capabilities, provider, providers, workspaces]),
  );
  let error = binding.error;
  for (const failure of [providers.error, workspaces.error, capabilities.error])
    if (failure !== null) error = failure.message;
  return {
    access,
    modelKey,
    workspaceKey,
    modelOptions: models,
    workspaceOptions,
    changeModel,
    thinking: thinking ?? '',
    thinkingOptions,
    changeThinking,
    changeWorkspace: setWorkspaceKey,
    submit,
    read,
    refresh: refresh.run,
    pending: binding.pending,
    disabled:
      binding.pending ||
      modelKey.length === 0 ||
      workspaceKey.length === 0 ||
      thinking === null ||
      providers.data === undefined ||
      workspaces.data === undefined,
    error,
  };
};
