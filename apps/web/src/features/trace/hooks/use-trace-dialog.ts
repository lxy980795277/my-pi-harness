import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AgentTaskList,
  SessionSnapshot,
  TraceEntry,
  TracePage,
  TraceQuery,
  UsageQuery,
} from '@my-pi-harness/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTraceStore, type TraceFilters } from '@/features/trace/stores/trace';
import { fetchTrace } from '@/features/trace/services/trace';
import { useAgentTasks } from '@/features/tasks/hooks/use-agent-tasks';
import {
  traceTaskItems,
  updateTraceFilter,
  type TraceTaskItem,
} from '@/features/trace/utils/trace-view';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface TraceEntryState {
  open: boolean;
  show: () => void;
}

interface TraceDialogState {
  query: UseQueryResult<TracePage, Error>;
  filters: TraceFilters;
  selected: TraceEntry | undefined;
  select: (entryId: string | null) => void;
  tree: TraceTaskItem[];
  tasks: UseQueryResult<AgentTaskList, Error>;
  page: number;
  previous: () => void;
  next: () => void;
  refresh: () => void;
  close: () => void;
  back: () => void;
  changeOpen: (open: boolean) => void;
  changeKind: (value: string) => void;
  changeStatus: (value: string) => void;
  changeBranch: (value: string) => void;
  changeTask: (value: string) => void;
  changeRun: (value: string) => void;
  allTasks: () => void;
  showUsage: boolean;
  toggleUsage: () => void;
  usageScope: UsageQuery;
  usageScopeKey: string;
  usageTitle: string;
  running: boolean;
}

/** Opening is presentation-only; switching conversations cannot reopen an older trace. */
export const useTraceEntry = (sessionId: string, branchId: string): TraceEntryState => {
  const openedSessionId = useTraceStore((state) => {
    return state.sessionId;
  });
  const open = useTraceStore((state) => {
    return state.open;
  });
  const close = useTraceStore((state) => {
    return state.close;
  });
  useEffect(() => {
    return (): void => {
      close(sessionId);
    };
  }, [close, sessionId]);
  const show = useCallback((): void => {
    open(sessionId, branchId);
  }, [branchId, open, sessionId]);
  return { open: openedSessionId === sessionId, show };
};

/** Only the visible page is retained; its continuation uses the host's frozen watermark. */
export const useTraceDialog = (snapshot: SessionSnapshot): TraceDialogState => {
  const client = useQueryClient();
  const sessionId = snapshot.session.id;
  const filters = useTraceStore((state) => {
    return state.filters;
  });
  const positions = useTraceStore((state) => {
    return state.positions;
  });
  const entryId = useTraceStore((state) => {
    return state.entryId;
  });
  const closeStore = useTraceStore((state) => {
    return state.close;
  });
  const setFilter = useTraceStore((state) => {
    return state.filter;
  });
  const select = useTraceStore((state) => {
    return state.select;
  });
  const nextStore = useTraceStore((state) => {
    return state.next;
  });
  const previous = useTraceStore((state) => {
    return state.previous;
  });
  const firstPage = useTraceStore((state) => {
    return state.firstPage;
  });
  const [generation, setGeneration] = useState(0);
  const [showUsage, setShowUsage] = useState(false);
  const tasks = useAgentTasks(sessionId);
  const running =
    snapshot.session.activeRunId !== null ||
    (tasks.data?.tasks.some((task) => {
      return task.status === 'queued' || task.status === 'running' || task.status === 'waiting';
    }) ??
      false);
  const position = positions.at(-1);
  const input: TraceQuery = { ...filters, ...position, limit: 50 };
  const query = useQuery({
    queryKey: ['trace', sessionId, generation, input],
    meta: { traceLivePage: positions.length === 1 },
    queryFn: ({ signal }) => {
      return fetchTrace(sessionId, input, signal);
    },
    gcTime: 0,
    enabled: !showUsage,
    refetchInterval: (): number | false => {
      if (positions.length > 1 || showUsage || !running) return false;
      return 1000;
    },
  });
  const tree = useMemo(() => {
    return traceTaskItems(tasks.data?.tasks ?? []);
  }, [tasks.data?.tasks]);
  const selected = query.data?.items.find((entry) => {
    return entry.id === entryId;
  });
  const close = useCallback((): void => {
    closeStore(sessionId);
  }, [closeStore, sessionId]);
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) close();
    },
    [close],
  );
  const changeKind = useCallback(
    (value: string): void => {
      setFilter(updateTraceFilter(filters, 'kind', value));
    },
    [filters, setFilter],
  );
  const changeStatus = useCallback(
    (value: string): void => {
      setFilter(updateTraceFilter(filters, 'status', value));
    },
    [filters, setFilter],
  );
  const changeBranch = useCallback(
    (value: string): void => {
      setFilter(updateTraceFilter(filters, 'branchId', value));
    },
    [filters, setFilter],
  );
  const changeTask = useCallback(
    (value: string): void => {
      setFilter(updateTraceFilter(filters, 'taskId', value));
    },
    [filters, setFilter],
  );
  const changeRun = useCallback(
    (value: string): void => {
      setFilter(updateTraceFilter(filters, 'runId', value));
    },
    [filters, setFilter],
  );
  const allTasks = useCallback((): void => {
    const next = { ...filters };
    delete next.taskId;
    delete next.runId;
    delete next.includeDescendants;
    setFilter(next);
  }, [filters, setFilter]);
  const next = useCallback((): void => {
    if (query.data?.nextCursor === null || query.data === undefined) return;
    nextStore({ cursor: query.data.nextCursor, watermark: query.data.watermark });
  }, [nextStore, query.data]);
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      firstPage();
      setGeneration((value) => {
        return value + 1;
      });
      await client.invalidateQueries({ queryKey: ['usage', sessionId] });
    }, [client, firstPage, sessionId]),
  );
  const toggleUsage = useCallback((): void => {
    setShowUsage((current) => {
      return !current;
    });
  }, []);
  const back = useCallback((): void => {
    select(null);
  }, [select]);
  const usageScope: UsageQuery = {};
  let usageTitle = '会话用量';
  if (filters.branchId !== undefined) {
    usageScope.branchId = filters.branchId;
    usageTitle = '分支用量';
  }
  if (filters.runId !== undefined) {
    usageScope.runId = filters.runId;
    usageTitle = '运行用量';
  }
  if (filters.taskId !== undefined) {
    usageScope.taskId = filters.taskId;
    usageTitle = '任务用量';
  }
  if (filters.includeDescendants !== undefined)
    usageScope.includeDescendants = filters.includeDescendants;
  return {
    query,
    filters,
    selected,
    select,
    tree,
    tasks,
    page: positions.length,
    previous,
    next,
    refresh: refresh.run,
    close,
    back,
    changeOpen,
    changeKind,
    changeStatus,
    changeBranch,
    changeTask,
    changeRun,
    allTasks,
    showUsage,
    toggleUsage,
    usageScope,
    usageScopeKey: JSON.stringify(usageScope),
    usageTitle,
    running,
  };
};
