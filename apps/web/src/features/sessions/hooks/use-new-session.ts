import type { DefaultModel, ProviderConfig, SessionSnapshot } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type ChangeEvent, type SubmitEvent } from 'react';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useNavigationStore } from '@/app/stores/navigation';
import { useSettingsStore } from '@/features/settings/stores/settings';
import {
  useAttachmentDrafts,
  EMPTY_ATTACHMENTS,
} from '@/features/attachments/stores/attachment-drafts';
import { useModelCatalog, useProviderModels } from '@/features/models/hooks/use-model-catalog';
import { buildModelMenuGroups } from '@/features/models/utils/model-menu';
import {
  buildThinkingOptions,
  findModelSelection,
  modelSelectionKey,
  resolveThinkingLevel,
} from '@/features/models/utils/model-options';
import { mergeSessionSnapshot } from '@/features/sessions/queries/projection';
import { createSession, submitInput } from '@/features/sessions/services/sessions';
import type { ComposerChoices, NewSessionState } from '@/features/sessions/types/composer';
import {
  buildWorkspaceOptions,
  NO_WORKSPACE,
  readApprovalMode,
  titleFromFirstMessage,
} from '@/features/sessions/utils/composer-options';
import { useComposerSkillSelection } from '@/features/skills/hooks/use-composer-skill-selection';
import { useComposerMcpSelection } from '@/features/mcp/hooks/use-composer-mcp-selection';
import { isRejectedInput } from '@/utils/input-outcome';
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
  const storedDraft = useComposerStore((state) => {
    return state.newConversationDraft;
  });
  const setDraft = useComposerStore((state) => {
    return state.setNewConversationDraft;
  });
  const selectedModel = useComposerStore((state) => {
    return state.newConversationModel;
  });
  const setModel = useComposerStore((state) => {
    return state.setNewConversationModel;
  });
  const workspaceId = useNavigationStore((state) => {
    return state.activeWorkspaceId;
  });
  const selectWorkspace = useNavigationStore((state) => {
    return state.selectWorkspace;
  });
  const approvalMode = useComposerStore((state) => {
    return state.newConversationApproval;
  });
  const setApproval = useComposerStore((state) => {
    return state.setNewConversationApproval;
  });
  const openSettings = useSettingsStore((state) => {
    return state.openSettings;
  });
  const generation = useComposerStore((state) => {
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
  const attempt = useComposerStore((state) => {
    return state.newConversationAttempt;
  });
  const beginAttempt = useComposerStore((state) => {
    return state.beginNewAttempt;
  });
  const markCreated = useComposerStore((state) => {
    return state.markNewAttemptCreated;
  });
  const markUnknown = useComposerStore((state) => {
    return state.markNewAttemptUnknown;
  });
  const clearAttempt = useComposerStore((state) => {
    return state.clearNewAttempt;
  });
  const confirmInput = useComposerStore((state) => {
    return state.confirmInput;
  });
  const prepareInput = useComposerStore((state) => {
    return state.prepareInput;
  });
  const clearPendingInput = useComposerStore((state) => {
    return state.clearPendingInput;
  });
  let selection = selectedModel;
  if (attempt !== null) {
    selection = attempt.model;
  } else if (selection === null && catalog.settings.data !== undefined) {
    selection = catalog.settings.data.defaultModel;
  }
  let draft = storedDraft;
  let attachmentIds = attachments.map((attachment) => {
    return attachment.id;
  });
  let selectedWorkspaceId = workspaceId;
  let selectedApprovalMode = approvalMode;
  if (attempt) {
    draft = attempt.input.text;
    if (attempt.input.attachmentIds !== undefined) {
      attachmentIds = attempt.input.attachmentIds;
    }
    selectedWorkspaceId = attempt.workspaceId;
    selectedApprovalMode = attempt.approvalMode;
  }
  const mcp = useComposerMcpSelection(
    attachmentDraftKey,
    selectedWorkspaceId,
    selectedApprovalMode,
    attempt !== null,
    attempt?.input.mcpTools,
  );
  const skills = useComposerSkillSelection(
    attachmentDraftKey,
    selectedWorkspaceId,
    attempt !== null,
    attempt?.input.skills,
  );
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
        if (attachmentBusy || ((mcp.blocked || skills.blocked) && attempt === null)) {
          return;
        }
        if (!selection || (!valid && !attempt)) {
          throw new Error('请选择可用的对话模型。');
        }
        let current = attempt;
        if (!current) {
          const text = draft.trim();
          if (text.length === 0 && attachments.length === 0) {
            return;
          }
          current = beginAttempt(generation, {
            model: selection,
            workspaceId,
            approvalMode,
            input: {
              text,
              mode: 'send',
              mcpTools: mcp.selected,
              skills: skills.selected,
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
                title: titleFromFirstMessage(current.input.text, attachments),
                ...current.model,
                workspaceId: current.workspaceId,
                approvalMode: current.approvalMode,
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
            clearAttempt(generation);
            const created = client.getQueryData<SessionSnapshot>(['session', current.sessionId]);
            if (created !== undefined && !signal.aborted) {
              onCreated(created);
            }
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
        mcp.blocked,
        mcp.selected,
        skills.blocked,
        skills.selected,
        markUnknown,
        onCreated,
        prepareInput,
        selection,
        valid,
        workspaceId,
      ],
    ),
  );
  const { run: sendRun } = send;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
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
    approvalMode: selectedApprovalMode,
    changeApprovalMode,
    modelKey,
    modelGroups: buildModelMenuGroups(providers, selection),
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
  let error = send.error;
  if (error === null) {
    error = creationWarning;
  }
  if (error === null && catalog.settings.error !== null) {
    error = catalog.settings.error.message;
  }
  if (error === null && workspaces.error !== null) {
    error = workspaces.error.message;
  }
  return {
    attachmentDraftKey,
    mcp,
    skills,
    attachmentIds,
    removeAttachment,
    draft,
    changeDraft,
    submit,
    choices,
    pending: send.pending,
    draftLocked: attempt !== null,
    disabled:
      send.pending ||
      attachmentBusy ||
      ((mcp.blocked || skills.blocked) && attempt === null) ||
      attempt?.phase === 'unknown' ||
      attempt?.phase === 'creating' ||
      (!attempt && valid === null) ||
      (draft.trim().length === 0 && attachments.length === 0),
    error: error,
    invalid: selection !== null && valid === null && attempt === null,
    uncertain: attempt?.phase === 'created' && !send.pending,
  };
};
