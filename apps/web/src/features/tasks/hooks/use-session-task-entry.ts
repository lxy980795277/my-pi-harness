import { useCallback } from 'react';
import { useAgentTasks } from '@/features/tasks/hooks/use-agent-tasks';
import { useTaskPresentationStore } from '@/features/tasks/stores/tasks';
import { taskNeedsAttention } from '@/features/tasks/utils/task-view';
import type { SessionTaskEntryState } from '@/features/tasks/types/tasks';

/** The header retains a fixed-height entry even while task summaries refresh. */
export const useSessionTaskEntry = (sessionId: string): SessionTaskEntryState => {
  const query = useAgentTasks(sessionId);
  const open = useTaskPresentationStore((state) => {
    return state.open;
  });
  const show = useCallback((): void => {
    open(sessionId);
  }, [open, sessionId]);
  const pending = query.data?.tasks.filter(taskNeedsAttention).length ?? 0;
  return { show, count: query.data?.tasks.length ?? 0, pending };
};
