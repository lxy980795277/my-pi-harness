import type { QueueItemState } from '@/features/sessions/types/session';
import type { QueueInput, QueuePatchInput } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Queue edits submit the observed revision and wait for the authoritative response. */
export const useQueueItem = (
  input: QueueInput,
  onUpdate: (id: string, patch: QueuePatchInput) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
): QueueItemState => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(input.text);
  const update = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await onUpdate(input.id, { text: text.trim(), revision: input.revision });
        signal.throwIfAborted();
        setEditing(false);
      },
      [input.id, input.revision, onUpdate, text],
    ),
  );
  const { clearError: updateClearError } = update;
  const remove = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await onDelete(input.id);
    }, [input.id, onDelete]),
  );
  const start = useCallback((): void => {
    setEditing(true);
  }, []);
  const cancel = useCallback((): void => {
    setEditing(false);
    setText(input.text);
    updateClearError();
  }, [input.text, updateClearError]);
  const changeText = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value);
  }, []);
  let error = update.error;
  if (error === null) {
    error = remove.error;
  }
  return {
    editing,
    text,
    changeText,
    start,
    cancel,
    update: update.run,
    remove: remove.run,
    pending: update.pending || remove.pending,
    error: error,
  };
};
