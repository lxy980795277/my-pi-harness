import type { ConversationState } from '@/features/sessions/types/session';
import { useCallback, useState } from 'react';
import { useSession } from '@/features/sessions/hooks/use-session';
import { useSessionCommands } from '@/features/sessions/hooks/use-session-commands';
import { deleteSession } from '@/features/sessions/services/sessions';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Lifecycle commands share the selected session's cancellation owner. */
export const useConversation = (sessionId: string, onDeleted: () => void): ConversationState => {
  const state = useSession(sessionId);
  const commands = useSessionCommands(sessionId);
  const { refetch } = state.query;
  const { branch: commandsBranch } = commands;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const branch = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, id: string): Promise<void> => {
        await commandsBranch(id);
      },
      [commandsBranch],
    ),
  );
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await deleteSession(sessionId, signal);
        signal.throwIfAborted();
        onDeleted();
      },
      [onDeleted, sessionId],
    ),
  );
  const reload = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await refetch();
    }, [refetch]),
  );
  const openDelete = useCallback((): void => {
    setConfirmDelete(true);
  }, []);
  const cancelDelete = useCallback((): void => {
    setConfirmDelete(false);
  }, []);
  const snapshot = state.query.data;
  const branches = snapshot?.branches ?? [];
  const branchOptions = branches.map((entry, index) => {
    let label = `修订分支 ${index}`;
    if (entry.parentId === null) {
      label = '主分支';
    }
    return { value: entry.id, label };
  });
  let branchError = branch.error;
  if (branchError === null) {
    branchError = remove.error;
  }
  if (branchError === null) {
    branchError = reload.error;
  }
  return {
    ...state,
    commands,
    snapshot,
    lastRun: snapshot?.runs.at(-1),
    branchOptions,
    branch: branch.run,
    branchPending: branch.pending,
    confirmDelete,
    openDelete,
    cancelDelete,
    remove: remove.run,
    deletePending: remove.pending,
    reload: reload.run,
    branchError: branchError,
  };
};
