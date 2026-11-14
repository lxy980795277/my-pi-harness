import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SessionUsage, UsageQuery } from '@my-pi-harness/protocol';
import { fetchUsage } from '@/features/usage/services/usage';

/** Mounted consumers own cancellable reads; unmounted answer history creates no usage queries. */
export const useUsage = (
  sessionId: string,
  scope: UsageQuery,
  running = false,
): UseQueryResult<SessionUsage, Error> => {
  return useQuery({
    queryKey: ['usage', sessionId, scope],
    queryFn: ({ signal }) => {
      return fetchUsage(sessionId, scope, signal);
    },
    gcTime: 0,
    refetchInterval: (): number | false => {
      if (running) return 1000;
      return false;
    },
  });
};
