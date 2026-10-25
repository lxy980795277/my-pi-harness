import type { Workspace } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { WORKSPACES_QUERY_OPTIONS } from '@/features/workspaces/queries/workspaces';

/** The sidebar and composer share one server-owned workspace catalog. */
export const useWorkspaces = (): UseQueryResult<Workspace[], Error> => {
  return useQuery(WORKSPACES_QUERY_OPTIONS);
};
