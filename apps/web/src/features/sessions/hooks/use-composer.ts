import type { ComposerState } from '@/features/sessions/types/session-view';
import type { InputRequest } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { isRejectedInput } from '@/features/sessions/utils/input-outcome';

const MODE_OPTIONS = [
  { value: 'follow-up', label: '排队 · 当前回复后继续' },
  { value: 'steer', label: '引导 · 中断当前模型请求' },
];

/** Uncertain retries keep their request id; successful submission clears only that session's draft. */
export const useComposer = (
  sessionId: string,
  activeRunId: string | null,
  onSend: (input: InputRequest) => Promise<void>,
  onStop: () => Promise<void>,
): ComposerState => {
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
  const draft = pendingInput?.text ?? storedDraft;
  const [mode, setMode] = useState<'follow-up' | 'steer'>('follow-up');
  const [stopRequestId, setStopRequestId] = useState<string | null>(null);
  const running = activeRunId !== null;
  const send = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, input: InputRequest): Promise<void> => {
        try {
          await onSend(input);
          signal.throwIfAborted();
          confirmInput(sessionId, input.requestId);
        } catch (failure: unknown) {
          if (isRejectedInput(failure)) {
            clearPendingInput(sessionId, input.requestId);
          }
          throw failure;
        }
      },
      [clearPendingInput, confirmInput, onSend, sessionId],
    ),
  );
  const { pending: sendPending } = send;
  const { run: sendRun } = send;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (sendPending || draft.trim().length === 0) {
        return;
      }
      const text = draft.trim();
      let submittedMode: InputRequest['mode'] = 'send';
      if (running) {
        submittedMode = mode;
      }
      const input = prepareInput(sessionId, {
        text,
        mode: submittedMode,
        requestId: crypto.randomUUID(),
      });
      sendRun(input);
    },
    [draft, mode, prepareInput, running, sendPending, sendRun, sessionId],
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
  const keyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      !event.nativeEvent.isComposing &&
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter'
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }, []);
  const changeMode = useCallback(
    (value: string): void => {
      if (pendingInput) {
        return;
      }
      if (value === 'follow-up' || value === 'steer') {
        setMode(value);
      }
    },
    [pendingInput],
  );
  let modeOptions = MODE_OPTIONS;
  if (pendingInput?.mode === 'send') {
    modeOptions = [{ value: 'send', label: '原始发送 · 等待确认' }];
  }
  return {
    draft,
    changeDraft,
    keyDown,
    mode: pendingInput?.mode ?? mode,
    changeMode,
    modeOptions,
    submit,
    stop: stop.run,
    running,
    stopping: running && stopRequestId === activeRunId,
    pending: sendPending,
    disabled: sendPending || draft.trim().length === 0,
    error: send.error ?? stop.error,
    draftLocked: pendingInput !== null,
    uncertain: pendingInput !== null && !sendPending,
  };
};
