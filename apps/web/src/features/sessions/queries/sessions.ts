import { queryOptions } from '@tanstack/react-query';
import { fetchSessions } from '@/features/sessions/services/sessions';

/** Shared initial data; the mounted navigation owns periodic session refreshes. */
export const SESSIONS_QUERY_OPTIONS = queryOptions({
  queryKey: ['sessions'],
  queryFn: ({ signal }) => {
    return fetchSessions(signal);
  },
  staleTime: 15_000,
});
