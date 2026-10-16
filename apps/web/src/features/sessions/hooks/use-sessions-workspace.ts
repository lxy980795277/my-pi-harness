import type { SessionsWorkspaceState } from '@/features/sessions/types/session';
import type { ProviderConfig, SessionSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { fetchProviders } from '@/features/models/services/providers';
import { mergeSessionSnapshot } from '@/features/sessions/queries/projection';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Navigation owns selections only; server lists and snapshots stay in Query. */
export const useSessionsWorkspace = (): SessionsWorkspaceState => {
  const client = useQueryClient();
  const activeId = useWorkspaceStore((state) => {
    return state.activeSessionId;
  });
  const selectSession = useWorkspaceStore((state) => {
    return state.selectSession;
  });
  const clearSelection = useWorkspaceStore((state) => {
    return state.clearSelection;
  });
  const generation = useWorkspaceStore((state) => {
    return state.newConversationGeneration;
  });
  const providersQuery = useQuery({
    queryKey: ['providers'],
    queryFn: ({ signal }): Promise<ProviderConfig[]> => {
      return fetchProviders(signal);
    },
  });
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['sessions'] });
    }, [client]),
  );
  const { run: refreshRun } = refresh;
  const created = useCallback(
    (snapshot: SessionSnapshot): void => {
      mergeSessionSnapshot(client, snapshot);
      selectSession(snapshot.session.id);
      refreshRun();
    },
    [client, refreshRun, selectSession],
  );
  const deleted = useCallback((): void => {
    if (activeId) {
      client.removeQueries({ queryKey: ['session', activeId], exact: true });
    }
    clearSelection();
    refreshRun();
  }, [activeId, clearSelection, client, refreshRun]);
  return { activeId, generation, providersQuery, created, deleted };
};
