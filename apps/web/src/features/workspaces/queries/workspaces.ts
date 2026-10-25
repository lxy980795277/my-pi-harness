import { queryOptions } from '@tanstack/react-query';
import { fetchWorkspaces } from '@/features/workspaces/services/workspaces';

/** Startup, navigation and the composer share one short-lived workspace snapshot. */
export const WORKSPACES_QUERY_OPTIONS = queryOptions({
  queryKey: ['workspaces'],
  queryFn: ({ signal }) => {
    return fetchWorkspaces(signal);
  },
  staleTime: 15_000,
});
