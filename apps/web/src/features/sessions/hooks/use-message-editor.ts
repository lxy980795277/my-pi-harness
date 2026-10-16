import type { MessageEditorState } from '@/features/sessions/types/session';
import type { EditInput, MessageView } from '@my-pi-harness/protocol';
import { useCallback, useRef, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Editing retries retain one request id until the branch creation is acknowledged. */
export const useMessageEditor = (
  message: MessageView,
  onEdit: (input: EditInput) => Promise<void>,
): MessageEditorState => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const attempt = useRef<EditInput | null>(null);
  const edit = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, input: EditInput): Promise<void> => {
        await onEdit(input);
        signal.throwIfAborted();
        setEditing(false);
        attempt.current = null;
      },
      [onEdit],
    ),
  );
  const { clearError: editClearError } = edit;
  const { run: editRun } = edit;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const trimmed = text.trim();
      let requestId: string = crypto.randomUUID();
      if (attempt.current?.text === trimmed) {
        requestId = attempt.current.requestId;
      }
      const input = { messageId: message.id, text: trimmed, requestId };
      attempt.current = input;
      editRun(input);
    },
    [editRun, message.id, text],
  );
  const start = useCallback((): void => {
    setText(message.text);
    setEditing(true);
    editClearError();
  }, [editClearError, message.text]);
  const cancel = useCallback((): void => {
    setEditing(false);
    editClearError();
  }, [editClearError]);
  const changeText = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value);
  }, []);
  return {
    editing,
    text,
    changeText,
    submit,
    start,
    cancel,
    pending: edit.pending,
    error: edit.error,
  };
};
