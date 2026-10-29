import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { fetchAgentBoard } from '@/features/tasks/services/agents';
import { useTaskPresentationStore, type TaskFilter } from '@/features/tasks/stores/tasks';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { taskBoardColumns } from '@/features/tasks/utils/task-view';
import type { TaskBoardState } from '@/features/tasks/types/tasks';

const FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '进行中' },
  { value: 'pending', label: '待人工确认' },
  { value: 'ended', label: '已结束' },
];

/** One bounded board query is invalidated by the workspace's shared task stream. */
export const useTaskBoard = (): TaskBoardState => {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const filter = useTaskPresentationStore((state) => {
    return state.filter;
  });
  const setFilter = useTaskPresentationStore((state) => {
    return state.setFilter;
  });
  const workspaces = useWorkspaces();
  const query = useQuery({
    queryKey: ['agent-board', workspaceId, filter, cursor],
    queryFn: ({ signal }) => {
      return fetchAgentBoard(workspaceId, cursor, filter, signal);
    },
  });
  const workspaceOptions = useMemo(() => {
    return [
      { value: 'all', label: '全部工作区' },
      ...(workspaces.data ?? []).map((workspace) => {
        return { value: workspace.id, label: workspace.name };
      }),
    ];
  }, [workspaces.data]);
  const changeWorkspace = useCallback((value: string): void => {
    if (value === 'all') setWorkspaceId(null);
    else setWorkspaceId(value);
    setCursor(0);
  }, []);
  const changeFilter = useCallback(
    (value: string): void => {
      const valid: readonly TaskFilter[] = ['all', 'active', 'pending', 'ended'];
      for (const option of valid) {
        if (option === value) {
          setFilter(option);
          setCursor(0);
          return;
        }
      }
    },
    [setFilter],
  );
  const tasks = query.data?.tasks ?? [];
  const previous = useCallback((): void => {
    setCursor((current) => {
      return Math.max(0, current - 100);
    });
  }, []);
  const next = useCallback((): void => {
    if (query.data?.nextCursor !== null && query.data?.nextCursor !== undefined)
      setCursor(query.data.nextCursor);
  }, [query.data?.nextCursor]);
  return {
    query,
    cursor,
    previous,
    next,
    tasks,
    columns: taskBoardColumns(tasks),
    workspaceId,
    workspaceOptions,
    changeWorkspace,
    filter,
    filterOptions: FILTERS,
    changeFilter,
  };
};
