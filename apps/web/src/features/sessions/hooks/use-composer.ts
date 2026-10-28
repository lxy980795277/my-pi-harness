import {
  useAttachmentDrafts,
  EMPTY_ATTACHMENTS,
} from '@/features/attachments/stores/attachment-drafts';
import type { ComposerState } from '@/features/sessions/types/session';
import type { InputRequest, RunView, SessionSummary } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  useComposerSkillSelection,
  EMPTY_SKILL_SELECTIONS,
} from '@/features/skills/hooks/use-composer-skill-selection';
import { useComposerMcpSelection } from '@/features/mcp/hooks/use-composer-mcp-selection';
import { EMPTY_MCP_SELECTIONS } from '@/features/mcp/utils/mcp-selection';
import { isRejectedInput } from '@/features/sessions/utils/input-outcome';

/** Uncertain retries keep their request id; successful submission clears only that session's draft. */
export const useComposer = (
  session: SessionSummary,
  activeRun: RunView | undefined,
  onSend: (input: InputRequest) => Promise<void>,
  onStop: () => Promise<void>,
): ComposerState => {
  const sessionId = session.id;
  const activeRunId = session.activeRunId;
  const attachments = useAttachmentDrafts((state) => {
    return state.drafts[sessionId] ?? EMPTY_ATTACHMENTS;
  });
  const attachmentBusy = useAttachmentDrafts((state) => {
    return state.busy[sessionId] ?? false;
  });
  const clearAttachments = useAttachmentDrafts((state) => {
    return state.clear;
  });
  const removeDraftAttachment = useAttachmentDrafts((state) => {
    return state.remove;
  });
  const storedDraft = useComposerStore((state): string => {
    return state.drafts[sessionId] ?? '';
  });
  const setDraft = useComposerStore((state) => {
    return state.setDraft;
  });
  const confirmInput = useComposerStore((state) => {
    return state.confirmInput;
  });
  const pendingInput = useComposerStore((state) => {
    return state.pendingInputs[sessionId] ?? null;
  });
  const prepareInput = useComposerStore((state) => {
    return state.prepareInput;
  });
  const clearPendingInput = useComposerStore((state) => {
    return state.clearPendingInput;
  });
  let draft = storedDraft;
  let attachmentIds = attachments.map((attachment) => {
    return attachment.id;
  });
  if (pendingInput !== null) {
    draft = pendingInput.text;
    if (pendingInput.attachmentIds !== undefined) {
      attachmentIds = pendingInput.attachmentIds;
    }
  }
  const [stopRequestId, setStopRequestId] = useState<string | null>(null);
  const running = activeRunId !== null;
  const send = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, input: InputRequest): Promise<void> => {
        try {
          await onSend(input);
          signal.throwIfAborted();
          confirmInput(sessionId, input.requestId);
          clearAttachments(sessionId);
        } catch (failure: unknown) {
          if (isRejectedInput(failure)) {
            clearPendingInput(sessionId, input.requestId);
          }
          throw failure;
        }
      },
      [clearAttachments, clearPendingInput, confirmInput, onSend, sessionId],
    ),
  );
  const { pending: sendPending } = send;
  let frozen = pendingInput?.mcpTools;
  if (running && pendingInput === null) {
    frozen = activeRun?.mcpTools ?? EMPTY_MCP_SELECTIONS;
  }
  const mcp = useComposerMcpSelection(
    sessionId,
    session.workspaceId,
    session.approvalMode,
    sendPending || pendingInput !== null || running,
    frozen,
  );
  let frozenSkills = pendingInput?.skills;
  if (running && pendingInput === null) frozenSkills = activeRun?.skills ?? EMPTY_SKILL_SELECTIONS;
  const skills = useComposerSkillSelection(
    sessionId,
    session.workspaceId,
    sendPending || pendingInput !== null || running,
    frozenSkills,
  );
  const { run: sendRun } = send;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (
        sendPending ||
        attachmentBusy ||
        ((mcp.blocked || skills.blocked) && pendingInput === null) ||
        (running && activeRun === undefined) ||
        (draft.trim().length === 0 && attachments.length === 0)
      ) {
        return;
      }
      const text = draft.trim();
      let submittedMode: InputRequest['mode'] = 'send';
      if (running) {
        submittedMode = 'follow-up';
      }
      const input = prepareInput(sessionId, {
        text,
        mode: submittedMode,
        requestId: crypto.randomUUID(),
        mcpTools: mcp.selected,
        skills: skills.selected,
        attachmentIds: attachments.map((attachment) => {
          return attachment.id;
        }),
      });
      sendRun(input);
    },
    [
      activeRun,
      attachmentBusy,
      attachments,
      draft,
      mcp.blocked,
      mcp.selected,
      skills.blocked,
      skills.selected,
      pendingInput,
      prepareInput,
      running,
      sendPending,
      sendRun,
      sessionId,
    ],
  );
  const stop = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      setStopRequestId(activeRunId);
      try {
        await onStop();
      } catch (failure) {
        setStopRequestId(null);
        throw failure;
      }
    }, [activeRunId, onStop]),
  );
  const changeDraft = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      if (pendingInput) {
        return;
      }
      setDraft(sessionId, event.target.value);
    },
    [pendingInput, sessionId, setDraft],
  );
  const removeAttachment = useCallback(
    (id: string): void => {
      if (!pendingInput && !attachmentBusy) {
        removeDraftAttachment(sessionId, id);
      }
    },
    [attachmentBusy, pendingInput, removeDraftAttachment, sessionId],
  );
  let error = send.error;
  if (error === null) {
    error = stop.error;
  }
  return {
    attachmentDraftKey: sessionId,
    mcp,
    skills,
    attachmentIds,
    removeAttachment,
    draft,
    changeDraft,
    submit,
    stop: stop.run,
    running,
    stopping: running && stopRequestId === activeRunId,
    pending: sendPending,
    disabled:
      sendPending ||
      attachmentBusy ||
      ((mcp.blocked || skills.blocked) && pendingInput === null) ||
      (running && activeRun === undefined) ||
      (draft.trim().length === 0 && attachments.length === 0),
    error: error,
    draftLocked: pendingInput !== null,
    uncertain: pendingInput !== null && !sendPending,
  };
};
