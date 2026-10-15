import type { Workspace } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useSessionList } from '@/features/sessions/hooks/use-session-list';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { removeWorkspace } from '@/features/workspaces/services/workspaces';
import { buildWorkspaceGroups } from '@/features/workspaces/utils/workspace-tree';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { WorkspaceTreeState } from '@/features/workspaces/types/workspace-view';

/** One sidebar presents all durable conversations; no second list owns navigation. */
export const useWorkspaceTree = (): WorkspaceTreeState => {
  const workspaces = useWorkspaces();
  const sessions = useSessionList();
  const client = useQueryClient();
  const activeId = useWorkspaceStore((state) => {
    return state.activeSessionId;
  });
  const activeWorkspaceId = useWorkspaceStore((state) => {
    return state.activeWorkspaceId;
  });
  const selectSession = useWorkspaceStore((state) => {
    return state.selectSession;
  });
  const selectWorkspace = useWorkspaceStore((state) => {
    return state.selectWorkspace;
  });
  const startNewConversation = useWorkspaceStore((state) => {
    return state.startNewConversation;
  });
  const newConversation = useCallback(
    (workspaceId: string | null): void => {
      selectWorkspace(workspaceId);
      startNewConversation();
    },
    [selectWorkspace, startNewConversation],
  );
  const [dialog, setDialog] = useState<{ workspace: Workspace | null } | null>(null);
  const [removing, setRemoving] = useState<Workspace | null>(null);
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (!removing) {
          return;
        }
        await removeWorkspace(removing.id, signal);
        signal.throwIfAborted();
        if (activeWorkspaceId === removing.id) {
          selectWorkspace(null);
        }
        await client.invalidateQueries({ queryKey: ['workspaces'] });
        signal.throwIfAborted();
        setRemoving(null);
      },
      [activeWorkspaceId, client, removing, selectWorkspace],
    ),
  );
  const add = useCallback((): void => {
    setDialog({ workspace: null });
  }, []);
  const rename = useCallback((workspace: Workspace): void => {
    setDialog({ workspace });
  }, []);
  const closeDialog = useCallback((): void => {
    setDialog(null);
  }, []);
  const { clearError: clearRemoveError } = remove;
  const requestRemove = useCallback(
    (workspace: Workspace): void => {
      clearRemoveError();
      setRemoving(workspace);
    },
    [clearRemoveError],
  );
  const cancelRemove = useCallback((): void => {
    if (!remove.pending) {
      setRemoving(null);
    }
  }, [remove.pending]);
  const changeRemoveOpen = useCallback(
    (open: boolean): void => {
      if (!open && !remove.pending) {
        setRemoving(null);
      }
    },
    [remove.pending],
  );
  const select = useCallback(
    (id: string): void => {
      const session = sessions.data?.find((entry) => {
        return entry.id === id;
      });
      if (session) {
        selectWorkspace(session.workspaceId);
        selectSession(session.id);
      }
    },
    [selectSession, selectWorkspace, sessions.data],
  );
  return {
    groups: buildWorkspaceGroups(workspaces.data ?? [], sessions.data ?? []),
    activeId,
    activeWorkspaceId,
    select,
    newConversation,
    add,
    rename,
    dialog,
    closeDialog,
    requestRemove,
    removing,
    confirmRemove: remove.run,
    cancelRemove,
    changeRemoveOpen,
    removingPending: remove.pending,
    removeError: remove.error,
    pending: workspaces.isPending || sessions.isPending,
    error: workspaces.error?.message ?? sessions.error?.message ?? null,
  };
};
