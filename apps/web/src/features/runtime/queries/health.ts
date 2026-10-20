import { PROTOCOL_VERSION, type HealthResponse } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchHealth } from '@/features/runtime/services/health';

/** Public health data is qualified by the protocol expected by this renderer. */
export const HEALTH_QUERY_KEY = ['runtime', 'health', PROTOCOL_VERSION] as const;

/** Keeps daemon health in the request cache, separate from transient event state. */
export const useHealth = (): UseQueryResult<HealthResponse, Error> => {
  return useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => {
      return fetchHealth(signal);
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
};
