import type { McpServerView } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchMcpServers } from '@/features/mcp/services/mcp';

/** Opening configuration reads server facts and never starts external processes. */
export const useMcpServers = (enabled = true): UseQueryResult<McpServerView[], Error> => {
  return useQuery({
    queryKey: ['mcp', 'servers'],
    queryFn: ({ signal }) => {
      return fetchMcpServers(signal);
    },
    enabled,
  });
};
