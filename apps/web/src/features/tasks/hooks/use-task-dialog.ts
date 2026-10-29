import { useCallback, useMemo } from 'react';
import { useNavigationStore } from '@/app/stores/navigation';
import { useTaskPresentationStore } from '@/features/tasks/stores/tasks';
import { useAgentTasks } from '@/features/tasks/hooks/use-agent-tasks';
import { buildTaskTree, taskNeedsAttention } from '@/features/tasks/utils/task-view';
import type { TaskDialogState } from '@/features/tasks/types/tasks';

/** The selected id is presentation state; the current branch's query decides what is visible. */
export const useTaskDialog = (): TaskDialogState => {
  const sessionId = useTaskPresentationStore((state) => {
    return state.sessionId;
  });
  const selectedId = useTaskPresentationStore((state) => {
    return state.taskId;
  });
  const close = useTaskPresentationStore((state) => {
    return state.close;
  });
  const selectSession = useNavigationStore((state) => {
    return state.selectSession;
  });
  const query = useAgentTasks(sessionId);
  const tasks = query.data?.tasks;
  const selected =
    tasks?.find((task) => {
      return task.id === selectedId;
    }) ??
    tasks?.find(taskNeedsAttention) ??
    tasks?.[0];
  const tree = useMemo(() => {
    return buildTaskTree(tasks ?? []);
  }, [tasks]);
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) close();
    },
    [close],
  );
  const conversation = useCallback((): void => {
    if (sessionId !== null) selectSession(sessionId);
    close();
  }, [close, selectSession, sessionId]);
  return { sessionId, selected, tree, query, changeOpen, conversation };
};
