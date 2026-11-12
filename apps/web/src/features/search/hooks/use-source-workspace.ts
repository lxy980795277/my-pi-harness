import { useQuery } from '@tanstack/react-query';
import { WORKSPACES_QUERY_OPTIONS } from '@/features/workspaces/queries/workspaces';
import type { SourceWorkspaceView } from '@/features/search/types/search';
import { sourceWorkspaceView } from '@/features/search/utils/search';

/** Search results and reader headers share the same workspace catalog and name resolution. */
export const useSourceWorkspace = (workspaceId: string | null): SourceWorkspaceView => {
  const workspaces = useQuery(WORKSPACES_QUERY_OPTIONS);
  return sourceWorkspaceView(workspaceId, workspaces.data ?? []);
};
