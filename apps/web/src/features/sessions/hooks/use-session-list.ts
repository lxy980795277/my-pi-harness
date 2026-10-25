import type { SessionSummary } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { SESSIONS_QUERY_OPTIONS } from '@/features/sessions/queries/sessions';

/** Shares the persisted conversation list between navigation and creation recovery. */
export const useSessionList = (): UseQueryResult<SessionSummary[], Error> => {
  return useQuery({
    ...SESSIONS_QUERY_OPTIONS,
    refetchInterval: 15000,
  });
};
