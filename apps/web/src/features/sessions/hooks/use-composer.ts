import {
  useAttachmentDrafts,
  EMPTY_ATTACHMENTS,
} from '@/features/attachments/stores/attachment-drafts';
import type { ComposerState } from '@/features/sessions/types/session';
import type { InputRequest } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { isRejectedInput } from '@/features/sessions/utils/input-outcome';

/** Uncertain retries keep their request id; successful submission clears only that session's draft. */
export const useComposer = (
  sessionId: string,
  activeRunId: string | null,
  onSend: (input: InputRequest) => Promise<void>,
  onStop: () => Promise<void>,
): ComposerState => {
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
  const storedDraft = useWorkspaceStore((state): string => {
    return state.drafts[sessionId] ?? '';
  });
  const setDraft = useWorkspaceStore((state) => {
    return state.setDraft;
  });
  const confirmInput = useWorkspaceStore((state) => {
    return state.confirmInput;
  });
  const pendingInput = useWorkspaceStore((state) => {
    return state.pendingInputs[sessionId] ?? null;
  });
  const prepareInput = useWorkspaceStore((state) => {
    return state.prepareInput;
  });
  const clearPendingInput = useWorkspaceStore((state) => {
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
  const { run: sendRun } = send;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (
        sendPending ||
        attachmentBusy ||
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
        attachmentIds: attachments.map((attachment) => {
          return attachment.id;
        }),
      });
      sendRun(input);
    },
    [attachmentBusy, attachments, draft, prepareInput, running, sendPending, sendRun, sessionId],
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
      sendPending || attachmentBusy || (draft.trim().length === 0 && attachments.length === 0),
    error: error,
    draftLocked: pendingInput !== null,
    uncertain: pendingInput !== null && !sendPending,
  };
};
