import type { QueueItemState } from '@/features/sessions/types/session';
import type { QueueInput, QueuePatchInput } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Queue edits keep the revision captured when editing starts until the draft is saved or cancelled. */
export const useQueueItem = (
  input: QueueInput,
  onUpdate: (id: string, patch: QueuePatchInput) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
): QueueItemState => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<QueuePatchInput>({
    text: input.text,
    revision: input.revision,
  });
  const update = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await onUpdate(input.id, { text: draft.text.trim(), revision: draft.revision });
        signal.throwIfAborted();
        setEditing(false);
      },
      [draft, input.id, onUpdate],
    ),
  );
  const { clearError: updateClearError } = update;
  const remove = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await onDelete(input.id);
    }, [input.id, onDelete]),
  );
  const start = useCallback((): void => {
    setDraft({ text: input.text, revision: input.revision });
    updateClearError();
    setEditing(true);
  }, [input.revision, input.text, updateClearError]);
  const cancel = useCallback((): void => {
    setEditing(false);
    setDraft({ text: input.text, revision: input.revision });
    updateClearError();
  }, [input.revision, input.text, updateClearError]);
  const changeText = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    const text = event.target.value;
    setDraft((current) => {
      return { ...current, text };
    });
  }, []);
  let error = update.error;
  if (error === null) {
    error = remove.error;
  }
  return {
    editing,
    text: draft.text,
    changeText,
    start,
    cancel,
    update: update.run,
    remove: remove.run,
    pending: update.pending || remove.pending,
    error: error,
  };
};
