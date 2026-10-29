import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AgentTaskList } from '@my-pi-harness/protocol';
import { fetchAgentTasks } from '@/features/tasks/services/agents';
import { retainTaskList } from '@/features/tasks/utils/task-view';

/** Branch changes invalidate this server-owned tree through the shared change stream. */
export const useAgentTasks = (sessionId: string | null): UseQueryResult<AgentTaskList, Error> => {
  return useQuery({
    queryKey: ['agent-tasks', sessionId],
    enabled: sessionId !== null,
    queryFn: ({ signal }) => {
      if (sessionId === null) throw new Error('尚未选择会话。');
      return fetchAgentTasks(sessionId, signal);
    },
    structuralSharing: retainTaskList,
  });
};
