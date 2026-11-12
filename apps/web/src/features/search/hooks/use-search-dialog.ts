import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useNavigationStore } from '@/app/stores/navigation';
import { useSearchStore } from '@/features/search/stores/search';
import { fetchSearchResults } from '@/features/search/services/search';
import { SEARCH_INDEX_QUERY } from '@/features/search/hooks/use-search-resources';
import type {
  SearchDialogState,
  SearchIntent,
  SearchFilters,
} from '@/features/search/types/search';
import { searchInput, selectionFromHit } from '@/features/search/utils/search';
import { fetchSession } from '@/features/sessions/services/sessions';
import { WORKSPACES_QUERY_OPTIONS } from '@/features/workspaces/queries/workspaces';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { FormSubmit, InputChange } from '@/types/events';
import type { SearchHit } from '@my-pi-harness/protocol';

const BRANCH_TIME = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Search is an overlay: submitted inputs and cancellable reads never replace the active conversation. */
export const useSearchDialog = (): SearchDialogState => {
  const client = useQueryClient();
  const [ownerId] = useState((): string => {
    return crypto.randomUUID();
  });
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  const filters = useSearchStore((state) => {
    return state.filters;
  });
  const changeStore = useSearchStore((state) => {
    return state.change;
  });
  const selected = useSearchStore((state) => {
    return state.selected;
  });
  const select = useSearchStore((state) => {
    return state.select;
  });
  const closeStore = useSearchStore((state) => {
    return state.close;
  });
  const cancelReading = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await client.cancelQueries({ queryKey: ['search-results', ownerId] });
    }, [client, ownerId]),
  );
  const { run: cancelRead } = cancelReading;
  const change = useCallback(
    (patch: Partial<SearchFilters>): void => {
      cancelRead();
      setIntent(null);
      changeStore(patch);
    },
    [cancelRead, changeStore],
  );
  const sessionId = useNavigationStore((state) => {
    return state.activeSessionId;
  });
  const selectedWorkspaceId = useNavigationStore((state) => {
    return state.activeWorkspaceId;
  });
  const workspaces = useQuery(WORKSPACES_QUERY_OPTIONS);
  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: ({ signal }) => {
      if (sessionId === null) throw new Error('未选择当前会话。');
      return fetchSession(sessionId, signal);
    },
    enabled: sessionId !== null,
  });
  let workspaceId = selectedWorkspaceId;
  if (sessionId !== null) workspaceId = session.data?.session.workspaceId ?? null;
  const workspaceOptions = [
    { value: 'current', label: '当前工作区' },
    { value: 'all', label: '所有工作区' },
    { value: 'unassigned', label: '未分配工作区' },
    ...(workspaces.data ?? []).map((workspace) => {
      return { value: workspace.id, label: workspace.name };
    }),
  ];
  if (workspaceId === null) workspaceOptions[0] = { value: 'current', label: '当前：未分配工作区' };
  const branchOptions = [{ value: 'visible', label: '当前可见分支' }];
  for (const branch of session.data?.branches ?? []) {
    let label = `历史分支 · ${BRANCH_TIME.format(branch.createdAt)}`;
    if (branch.id === session.data?.session.activeBranchId) label = '当前会话的执行分支';
    branchOptions.push({ value: branch.id, label });
  }
  const fingerprint = JSON.stringify([filters, workspaceId, sessionId]);
  const hasIntent = intent !== null && intent.fingerprint === fingerprint;
  const results = useQuery({
    queryKey: ['search-results', ownerId, intent?.input],
    meta: { memorySource: intent?.input.scope?.kind === 'memory' },
    queryFn: ({ signal }) => {
      if (intent === null) throw new Error('请先搜索。');
      return fetchSearchResults(intent.input, signal);
    },
    enabled: hasIntent,
  });
  const index = useQuery(SEARCH_INDEX_QUERY);
  const search = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      if (sessionId !== null && session.data === undefined)
        throw new Error('正在确认当前会话范围，请稍后搜索。');
      const input = searchInput(filters, workspaceId, sessionId, Date.now());
      setIntent({ input, fingerprint });
      select(null);
      await client.invalidateQueries({ queryKey: ['search-results', ownerId, input] });
    }, [client, filters, fingerprint, ownerId, select, session.data, sessionId, workspaceId]),
  );
  const { run: runSearch } = search;
  const submit: FormSubmit = useCallback(
    (event): void => {
      event.preventDefault();
      runSearch();
    },
    [runSearch],
  );
  const closeEvent = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      closeStore();
      await Promise.all([
        client.cancelQueries({ queryKey: ['search-results', ownerId] }),
        client.cancelQueries({ queryKey: ['search-source', ownerId] }),
      ]);
      client.removeQueries({ queryKey: ['search-results', ownerId] });
      client.removeQueries({ queryKey: ['search-source', ownerId] });
    }, [client, closeStore, ownerId]),
  );
  const { run: close } = closeEvent;
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) close();
    },
    [close],
  );
  const closeSource = useCallback((): void => {
    select(null);
  }, [select]);
  const openResult = useCallback(
    (hit: SearchHit): void => {
      select(selectionFromHit(hit));
    },
    [select],
  );
  const changeQuery: InputChange = useCallback(
    (event): void => {
      change({ query: event.target.value });
    },
    [change],
  );
  const changeKind = useCallback(
    (value: string): void => {
      if (value === 'message' || value === 'memory') change({ kind: value, branchId: 'visible' });
    },
    [change],
  );
  const changeWorkspace = useCallback(
    (workspace: string): void => {
      change({ workspace, branchId: 'visible' });
    },
    [change],
  );
  const changePeriod = useCallback(
    (value: string): void => {
      if (value === 'all' || value === 'week' || value === 'month' || value === 'year')
        change({ period: value });
    },
    [change],
  );
  const changeBranch = useCallback(
    (branchId: string): void => {
      change({ branchId });
    },
    [change],
  );
  const changeArchived = useCallback(
    (archived: boolean): void => {
      change({ archived });
    },
    [change],
  );
  const changeHistorical = useCallback(
    (historical: boolean): void => {
      change({ historical });
    },
    [change],
  );
  const changeTasks = useCallback(
    (tasks: boolean): void => {
      change({ tasks });
    },
    [change],
  );
  const changeUserMemories = useCallback(
    (userMemories: boolean): void => {
      change({ userMemories });
    },
    [change],
  );
  let indexLabel: string | null = null;
  if (index.data !== undefined)
    indexLabel = `语义索引 ${index.data.vectorCount} / ${index.data.chunkCount} 片段 · 待更新来源 ${index.data.pendingSources}`;
  let error = search.error;
  if (session.isError) error = session.error.message;
  if (workspaces.isError) error = workspaces.error.message;
  return {
    filters,
    changeQuery,
    changeKind,
    changeWorkspace,
    changePeriod,
    changeBranch,
    changeArchived,
    changeHistorical,
    changeTasks,
    changeUserMemories,
    workspaceOptions,
    branchOptions,
    submit,
    results,
    hasIntent,
    indexLabel,
    selected,
    openResult,
    closeSource,
    close,
    changeOpen,
    activeSessionId: sessionId,
    activeSnapshot: session.data,
    error,
    ownerId,
  };
};
