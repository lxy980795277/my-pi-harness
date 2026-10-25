import type { SessionsWorkspaceState } from '@/features/sessions/types/session';
import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useNavigationStore } from '@/app/stores/navigation';
import { PROVIDERS_QUERY_OPTIONS } from '@/features/models/queries/catalog';
import { mergeSessionSnapshot } from '@/features/sessions/queries/projection';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Navigation owns selections only; server lists and snapshots stay in Query. */
export const useSessionsWorkspace = (): SessionsWorkspaceState => {
  const client = useQueryClient();
  const activeId = useNavigationStore((state) => {
    return state.activeSessionId;
  });
  const selectSession = useNavigationStore((state) => {
    return state.selectSession;
  });
  const generation = useComposerStore((state) => {
    return state.newConversationGeneration;
  });
  const providersQuery = useQuery(PROVIDERS_QUERY_OPTIONS);
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
  return { activeId, generation, providersQuery, created };
};
