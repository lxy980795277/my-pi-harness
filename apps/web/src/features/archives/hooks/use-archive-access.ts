import type { SessionExecutionAccess } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { fetchArchiveAccess } from '@/features/archives/services/archive-access';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface ExecutionAccessState {
  query: UseQueryResult<SessionExecutionAccess, Error>;
  canExecute: boolean;
  refresh: () => void;
}

/** Only the open conversation checks its execution access; closed history has no background reads. */
export const useArchiveAccess = (
  sessionId: string,
): UseQueryResult<SessionExecutionAccess, Error> => {
  return useQuery({
    queryKey: ['archive-access', sessionId],
    queryFn: ({ signal }) => {
      return fetchArchiveAccess(sessionId, signal);
    },
    gcTime: 0,
    staleTime: 15000,
  });
};

/** The execution controls wait for current host access while historical text remains readable. */
export const useSessionExecutionAccess = (sessionId: string): ExecutionAccessState => {
  const query = useArchiveAccess(sessionId);
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await query.refetch();
    }, [query]),
  );
  return { query, canExecute: query.data?.bound === true, refresh: refresh.run };
};
