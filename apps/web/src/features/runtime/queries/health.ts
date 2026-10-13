import type { HealthResponse } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchHealth } from '@/features/runtime/services/health.js';

/** Keeps daemon health in the request cache, separate from transient event state. */
export const useHealth = (): UseQueryResult<HealthResponse, Error> => {
  return useQuery({
    queryKey: ['runtime', 'health'],
    queryFn: ({ signal }) => {
      return fetchHealth(signal);
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
};
