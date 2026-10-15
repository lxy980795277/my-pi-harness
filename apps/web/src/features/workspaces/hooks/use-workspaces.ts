import type { Workspace } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchWorkspaces } from '@/features/workspaces/services/workspaces';

/** The sidebar and composer share one server-owned workspace catalog. */
export const useWorkspaces = (): UseQueryResult<Workspace[], Error> => {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }): Promise<Workspace[]> => {
      return fetchWorkspaces(signal);
    },
  });
};
