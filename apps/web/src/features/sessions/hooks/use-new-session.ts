import type { DefaultModel, ProviderConfig, SessionSnapshot } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type ChangeEvent, type FormEvent } from 'react';
import {
  useAttachmentDrafts,
  EMPTY_ATTACHMENTS,
} from '@/features/attachments/stores/attachment-drafts';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useModelCatalog, useProviderModels } from '@/features/models/hooks/use-model-catalog';
import {
  buildThinkingOptions,
  findModelSelection,
  modelSelectionKey,
  resolveThinkingLevel,
} from '@/features/models/utils/model-options';
import { mergeSessionSnapshot } from '@/features/sessions/queries/projection';
import { createSession, submitInput } from '@/features/sessions/services/sessions';
import type { ComposerChoices, NewSessionState } from '@/features/sessions/types/composer-view';
import {
  buildComposerModelOptions,
  buildWorkspaceOptions,
  NO_WORKSPACE,
  readApprovalMode,
  titleFromFirstMessage,
} from '@/features/sessions/utils/composer-options';
import { composerKeyDown } from '@/features/sessions/utils/composer-key-down';
import { isRejectedInput } from '@/features/sessions/utils/input-outcome';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** The volatile attempt survives page switches; only explicit New Conversation starts another creation. */
export const useNewSession = (
  providers: ProviderConfig[],
  onCreated: (snapshot: SessionSnapshot) => void,
): NewSessionState => {
  const client = useQueryClient();
  const catalog = useModelCatalog();
  const workspaces = useWorkspaces();
  const storedDraft = useWorkspaceStore((state) => {
    return state.newConversationDraft;
  });
  const setDraft = useWorkspaceStore((state) => {
    return state.setNewConversationDraft;
  });
  const selectedModel = useWorkspaceStore((state) => {
    return state.newConversationModel;
  });
  const setModel = useWorkspaceStore((state) => {
    return state.setNewConversationModel;
  });
  const workspaceId = useWorkspaceStore((state) => {
    return state.activeWorkspaceId;
  });
  const selectWorkspace = useWorkspaceStore((state) => {
    return state.selectWorkspace;
  });
  const approvalMode = useWorkspaceStore((state) => {
    return state.newConversationApproval;
  });
  const workMode = useWorkspaceStore((state) => {
    return state.newConversationWorkMode;
  });
  const setWorkMode = useWorkspaceStore((state) => {
    return state.setNewConversationWorkMode;
  });
  const setApproval = useWorkspaceStore((state) => {
    return state.setNewConversationApproval;
  });
  const openSettings = useWorkspaceStore((state) => {
    return state.openSettings;
  });
  const generation = useWorkspaceStore((state) => {
    return state.newConversationGeneration;
  });
  const attachmentDraftKey = `new:${generation}`;
  const attachments = useAttachmentDrafts((state) => {
    return state.drafts[attachmentDraftKey] ?? EMPTY_ATTACHMENTS;
  });
  const attachmentBusy = useAttachmentDrafts((state) => {
    return state.busy[attachmentDraftKey] ?? false;
  });
  const clearAttachments = useAttachmentDrafts((state) => {
    return state.clear;
  });
  const removeDraftAttachment = useAttachmentDrafts((state) => {
    return state.remove;
  });
  const attempt = useWorkspaceStore((state) => {
    return state.newConversationAttempt;
  });
  const beginAttempt = useWorkspaceStore((state) => {
    return state.beginNewAttempt;
  });
  const markCreated = useWorkspaceStore((state) => {
    return state.markNewAttemptCreated;
  });
  const markUnknown = useWorkspaceStore((state) => {
    return state.markNewAttemptUnknown;
  });
  const clearAttempt = useWorkspaceStore((state) => {
    return state.clearNewAttempt;
  });
  const confirmInput = useWorkspaceStore((state) => {
    return state.confirmInput;
  });
  const prepareInput = useWorkspaceStore((state) => {
    return state.prepareInput;
  });
  const clearPendingInput = useWorkspaceStore((state) => {
    return state.clearPendingInput;
  });
  const selection = attempt?.model ?? selectedModel ?? catalog.settings.data?.defaultModel ?? null;
  const draft = attempt?.input.text ?? storedDraft;
  let selectedWorkspaceId = workspaceId;
  let selectedApprovalMode = approvalMode;
  if (attempt) {
    selectedWorkspaceId = attempt.workspaceId;
    selectedApprovalMode = attempt.approvalMode;
  }
  const provider = providers.find((entry) => {
    return entry.id === selection?.providerId;
  });
  const models = useProviderModels(provider?.id ?? '', provider?.revision, provider !== undefined);
  const model = models.data?.find((entry) => {
    return entry.id === selection?.modelId;
  });
  let modelKey = '';
  let valid: DefaultModel | null = null;
  if (selection) {
    modelKey = modelSelectionKey(selection.providerId, selection.modelId);
    valid = findModelSelection(providers, modelKey);
  }
  const send = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (attachmentBusy) {
          return;
        }
        if (!selection || (!valid && !attempt)) {
          throw new Error('请选择可用的对话模型。');
        }
        let current = attempt;
        if (!current) {
          const text = draft.trim();
          if (text.length === 0) {
            return;
          }
          current = beginAttempt(generation, {
            model: selection,
            workspaceId,
            approvalMode,
            workMode,
            input: {
              text,
              mode: 'send',
              requestId: crypto.randomUUID(),
              attachmentIds: attachments.map((attachment) => {
                return attachment.id;
              }),
            },
          });
        }
        if (!current) {
          return;
        }
        if (current.phase === 'unknown' || (current.phase === 'creating' && attempt !== null)) {
          throw new Error('会话创建结果尚未确认，请先检查左侧对话历史；点击“新对话”可重新开始。');
        }
        if (current.phase === 'creating') {
          let snapshot: SessionSnapshot;
          try {
            snapshot = await createSession(
              {
                title: titleFromFirstMessage(current.input.text),
                ...current.model,
                workspaceId: current.workspaceId,
                approvalMode: current.approvalMode,
                workMode: current.workMode,
              },
              signal,
            );
          } catch (failure: unknown) {
            if (isRejectedInput(failure)) {
              clearAttempt(generation);
              throw failure;
            }
            markUnknown(generation);
            await client.invalidateQueries({ queryKey: ['sessions'] });
            throw new Error(
              '会话创建结果尚未确认，请先检查左侧对话历史；点击“新对话”可重新开始。',
              { cause: failure },
            );
          }
          markCreated(generation, snapshot.session.id);
          current = { ...current, phase: 'created', sessionId: snapshot.session.id };
          mergeSessionSnapshot(client, snapshot);
          await client.invalidateQueries({ queryKey: ['sessions'] });
        }
        signal.throwIfAborted();
        const input = prepareInput(current.sessionId, current.input);
        try {
          const accepted = await submitInput(current.sessionId, input, signal);
          signal.throwIfAborted();
          confirmInput(current.sessionId, input.requestId);
          clearAttachments(attachmentDraftKey);
          onCreated(accepted);
        } catch (failure: unknown) {
          if (isRejectedInput(failure)) {
            clearPendingInput(current.sessionId, input.requestId);
          }
          throw failure;
        }
      },
      [
        attachmentBusy,
        attachmentDraftKey,
        attachments,
        clearAttachments,
        approvalMode,
        attempt,
        beginAttempt,
        clearAttempt,
        clearPendingInput,
        client,
        confirmInput,
        draft,
        generation,
        markCreated,
        markUnknown,
        onCreated,
        prepareInput,
        selection,
        valid,
        workspaceId,
        workMode,
      ],
    ),
  );
  const { run: sendRun } = send;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      sendRun();
    },
    [sendRun],
  );
  const changeDraft = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      if (!attempt) {
        setDraft(event.target.value);
      }
    },
    [attempt, setDraft],
  );
  const changeWorkspace = useCallback(
    (value: string): void => {
      if (value === NO_WORKSPACE) {
        selectWorkspace(null);
        return;
      }
      const workspace = workspaces.data?.find((entry) => {
        return entry.id === value;
      });
      if (workspace) {
        selectWorkspace(workspace.id);
      }
    },
    [selectWorkspace, workspaces.data],
  );
  const changeModel = useCallback(
    (value: string): void => {
      const next = findModelSelection(providers, value);
      if (next) {
        setModel(next);
      }
    },
    [providers, setModel],
  );
  const changeThinking = useCallback(
    (value: string): void => {
      if (selection && model) {
        setModel({ ...selection, thinkingLevel: resolveThinkingLevel(value, model) });
      }
    },
    [model, selection, setModel],
  );
  const changeApprovalMode = useCallback(
    (value: string): void => {
      const mode = readApprovalMode(value);
      if (mode) {
        setApproval(mode);
      }
    },
    [setApproval],
  );
  const changeWorkMode = useCallback(
    (value: string): void => {
      if (!attempt && (value === 'execute' || value === 'plan')) {
        setWorkMode(value);
      }
    },
    [attempt, setWorkMode],
  );
  const settings = useCallback((): void => {
    openSettings('models');
  }, [openSettings]);
  const workspace = workspaces.data?.find((entry) => {
    return entry.id === selectedWorkspaceId;
  });
  const choices: ComposerChoices = {
    workspaceValue: selectedWorkspaceId ?? NO_WORKSPACE,
    workspaceOptions: buildWorkspaceOptions(workspaces.data ?? []),
    workspaceLocked: attempt !== null,
    workspaceLabel: workspace?.name ?? '不使用工作区',
    workspaceIcon: workspace?.icon ?? 'folder',
    changeWorkspace,
    workMode: attempt?.workMode ?? workMode,
    changeWorkMode,
    workModeDisabled: send.pending || attempt !== null,
    approvalMode: selectedApprovalMode,
    changeApprovalMode,
    modelKey,
    modelOptions: buildComposerModelOptions(providers, selection),
    changeModel,
    thinking: selection?.thinkingLevel ?? 'off',
    thinkingOptions: buildThinkingOptions(model),
    changeThinking,
    settings,
    disabled: send.pending || attempt !== null,
  };
  let creationWarning: string | null = null;
  if (attempt && attempt.phase !== 'created' && !send.pending) {
    creationWarning = '会话创建结果尚未确认，请先检查左侧对话历史；点击“新对话”可重新开始。';
  }
  const removeAttachment = useCallback(
    (id: string): void => {
      if (!attempt && !attachmentBusy) {
        removeDraftAttachment(attachmentDraftKey, id);
      }
    },
    [attachmentBusy, attachmentDraftKey, attempt, removeDraftAttachment],
  );
  return {
    attachmentDraftKey,
    attachmentIds:
      attempt?.input.attachmentIds ??
      attachments.map((attachment) => {
        return attachment.id;
      }),
    removeAttachment,
    draft,
    changeDraft,
    submit,
    choices,
    keyDown: composerKeyDown,
    pending: send.pending,
    draftLocked: attempt !== null,
    disabled:
      send.pending ||
      attachmentBusy ||
      attempt?.phase === 'unknown' ||
      attempt?.phase === 'creating' ||
      (!attempt && valid === null) ||
      draft.trim().length === 0,
    error:
      send.error ??
      creationWarning ??
      catalog.settings.error?.message ??
      workspaces.error?.message ??
      null,
    invalid: selection !== null && valid === null && attempt === null,
    uncertain: attempt?.phase === 'created' && !send.pending,
  };
};
