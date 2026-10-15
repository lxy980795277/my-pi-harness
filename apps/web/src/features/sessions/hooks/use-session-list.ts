import type { SessionSummary } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchSessions } from '@/features/sessions/services/sessions';

/** Shares the persisted conversation list between navigation and creation recovery. */
export const useSessionList = (): UseQueryResult<SessionSummary[], Error> => {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }): Promise<SessionSummary[]> => {
      return fetchSessions(signal);
    },
    refetchInterval: 15000,
  });
};
