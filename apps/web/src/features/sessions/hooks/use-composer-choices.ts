import type { ProviderConfig, SessionPatchInput, SessionSummary } from '@my-pi-harness/protocol';
import { useCallback } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useProviderModels } from '@/features/models/hooks/use-model-catalog';
import {
  buildThinkingOptions,
  findModelSelection,
  modelSelectionKey,
  resolveThinkingLevel,
} from '@/features/models/utils/model-options';
import type { ComposerChoices, ComposerChoicesState } from '@/features/sessions/types/composer';
import {
  buildComposerModelOptions,
  buildWorkspaceOptions,
  NO_WORKSPACE,
  readApprovalMode,
} from '@/features/sessions/utils/composer-options';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { useComposerWorkMode } from '@/features/work/hooks/use-composer-work-mode';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Existing conversations retain their directory; model and policy changes affect future runs. */
export const useComposerChoices = (
  session: SessionSummary,
  providers: ProviderConfig[],
  onPatch: (input: SessionPatchInput) => Promise<void>,
): ComposerChoicesState => {
  const workMode = useComposerWorkMode(session);
  const workspaces = useWorkspaces();
  const openSettings = useWorkspaceStore((state) => {
    return state.openSettings;
  });
  const provider = providers.find((entry) => {
    return entry.id === session.providerId;
  });
  const models = useProviderModels(provider?.id ?? '', provider?.revision, provider !== undefined);
  const model = models.data?.find((entry) => {
    return entry.id === session.modelId;
  });
  const save = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, input: SessionPatchInput): Promise<void> => {
        await onPatch(input);
      },
      [onPatch],
    ),
  );
  const { run: saveRun } = save;
  const changeModel = useCallback(
    (value: string): void => {
      const selected = findModelSelection(providers, value);
      if (selected) {
        saveRun(selected);
      }
    },
    [providers, saveRun],
  );
  const changeThinking = useCallback(
    (value: string): void => {
      if (model) {
        saveRun({ thinkingLevel: resolveThinkingLevel(value, model) });
      }
    },
    [model, saveRun],
  );
  const changeApprovalMode = useCallback(
    (value: string): void => {
      const mode = readApprovalMode(value);
      if (mode) {
        saveRun({ approvalMode: mode });
      }
    },
    [saveRun],
  );
  const settings = useCallback((): void => {
    openSettings('models');
  }, [openSettings]);
  const changeWorkspace = useCallback((): void => {
    /* A conversation's directory stays fixed. */
  }, []);
  const workspace = workspaces.data?.find((entry) => {
    return entry.id === session.workspaceId;
  });
  let workspaceLabel = '不使用工作区';
  if (session.workspaceId) {
    workspaceLabel = workspace?.name ?? '工作区不可用';
  }
  const choices: ComposerChoices = {
    workspaceValue: session.workspaceId ?? NO_WORKSPACE,
    workspaceOptions: buildWorkspaceOptions(workspaces.data ?? []),
    workspaceLocked: true,
    workspaceLabel,
    workspaceIcon: workspace?.icon ?? 'folder',
    changeWorkspace,
    workMode: workMode.mode,
    changeWorkMode: workMode.change,
    workModeDisabled: workMode.disabled,
    approvalMode: session.approvalMode,
    changeApprovalMode,
    modelKey: modelSelectionKey(session.providerId, session.modelId),
    modelOptions: buildComposerModelOptions(providers, session),
    changeModel,
    thinking: session.thinkingLevel,
    thinkingOptions: buildThinkingOptions(model),
    changeThinking,
    settings,
    disabled: save.pending || session.activeRunId !== null,
  };
  let error = save.error;
  if (error === null) {
    error = workMode.error;
  }
  return {
    submitBlocked: save.pending || workMode.sendingBlocked,
    choices,
    error: error,
  };
};
