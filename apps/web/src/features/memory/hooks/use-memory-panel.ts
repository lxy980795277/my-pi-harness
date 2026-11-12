import type { MemoryEntry, MemoryListInput, MemoryScope } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useNavigationStore } from '@/app/stores/navigation';
import { useMemoryPage } from '@/features/memory/hooks/use-memory-queries';
import { useMemorySettings } from '@/features/memory/hooks/use-memory-settings';
import type {
  MemoryEditorTarget,
  MemoryModeFilter,
  MemoryPagination,
  MemoryPanelState,
  MemoryManagerView,
  MemoryCategoryFilter,
} from '@/features/memory/types/memory';
import { memoryPageCursors, memoryPageKey } from '@/features/memory/utils/memory-pagination';
import {
  memoryScopeKey,
  memoryScopeOptions,
  resolveMemoryScope,
} from '@/features/memory/utils/memory-view';
import { fetchSession } from '@/features/sessions/services/sessions';
import { WORKSPACES_QUERY_OPTIONS } from '@/features/workspaces/queries/workspaces';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** The selected conversation owns the current workspace, even when navigation last selected another. */
export const useMemoryPanel = (): MemoryPanelState => {
  const sessionId = useNavigationStore((state) => {
    return state.activeSessionId;
  });
  const selectedWorkspaceId = useNavigationStore((state) => {
    return state.activeWorkspaceId;
  });
  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: ({ signal }) => {
      if (sessionId === null) throw new Error('未选择会话。');
      return fetchSession(sessionId, signal);
    },
    enabled: sessionId !== null,
  });
  const workspaces = useQuery(WORKSPACES_QUERY_OPTIONS);
  let workspaceId: string | null = selectedWorkspaceId;
  if (sessionId !== null) workspaceId = session.data?.session.workspaceId ?? null;
  let workspaceName: string | null = null;
  for (const workspace of workspaces.data ?? []) {
    if (workspace.id === workspaceId) workspaceName = workspace.name;
  }
  const [selection, setSelection] = useState<'user' | 'workspace'>('workspace');
  let scope: MemoryScope = { kind: 'user' };
  if (selection === 'workspace' && workspaceId !== null) scope = { kind: 'workspace', workspaceId };
  const scopeValue = memoryScopeKey(scope);
  const scopeOptions = memoryScopeOptions(workspaceId, workspaceName);
  const [modeFilter, setModeFilter] = useState<MemoryModeFilter>('all');
  const [view, setView] = useState<MemoryManagerView>('entries');
  const [profileCategory, setProfileCategory] = useState<MemoryCategoryFilter>('all');
  const pageKey = memoryPageKey(scopeValue, modeFilter, view, profileCategory);
  let filter: Pick<MemoryListInput, 'enabled' | 'category'> | undefined;
  if (view === 'profile') {
    filter = { enabled: true };
    if (profileCategory !== 'all') filter.category = profileCategory;
  }
  const [pagination, setPagination] = useState<MemoryPagination>({ key: pageKey, cursors: [null] });
  const cursors = memoryPageCursors(pagination, pageKey);
  const cursor = cursors.at(-1) ?? null;
  const entries = useMemoryPage(scope, modeFilter, cursor, filter);
  const { settings, updateSettings, changeAllowUse, changeAllowLearning } = useMemorySettings();
  const client = useQueryClient();
  const [editor, setEditor] = useState<MemoryEditorTarget | null>(null);
  const changeScope = useCallback(
    (value: string): void => {
      if (value === 'user') {
        setSelection('user');
        setPagination({
          key: memoryPageKey(value, modeFilter, view, profileCategory),
          cursors: [null],
        });
      } else if (
        workspaceId !== null &&
        value === memoryScopeKey({ kind: 'workspace', workspaceId })
      ) {
        setSelection('workspace');
        setPagination({
          key: memoryPageKey(value, modeFilter, view, profileCategory),
          cursors: [null],
        });
      }
    },
    [modeFilter, profileCategory, view, workspaceId],
  );
  const changeModeFilter = useCallback(
    (value: string): void => {
      if (value !== 'all' && value !== 'fixed' && value !== 'relevant') return;
      setModeFilter(value);
      setPagination({
        key: memoryPageKey(scopeValue, value, view, profileCategory),
        cursors: [null],
      });
    },
    [profileCategory, scopeValue, view],
  );
  const resetPage = useCallback((): void => {
    setPagination({ key: pageKey, cursors: [null] });
  }, [pageKey]);
  const changeView = useCallback(
    (value: string): void => {
      if (value !== 'entries' && value !== 'profile') return;
      setView(value);
      setPagination({
        key: memoryPageKey(scopeValue, modeFilter, value, profileCategory),
        cursors: [null],
      });
    },
    [modeFilter, profileCategory, scopeValue],
  );
  const changeProfileCategory = useCallback(
    (value: string): void => {
      if (
        value === 'all' ||
        value === 'preference' ||
        value === 'fact' ||
        value === 'instruction'
      ) {
        setProfileCategory(value);
        setPagination({ key: memoryPageKey(scopeValue, modeFilter, view, value), cursors: [null] });
      }
    },
    [modeFilter, scopeValue, view],
  );
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      resetPage();
      await client.invalidateQueries({ queryKey: ['memories', scopeValue] });
    }, [client, resetPage, scopeValue]),
  );
  const previous = useCallback((): void => {
    if (cursors.length <= 1) return;
    setPagination({ key: pageKey, cursors: cursors.slice(0, -1) });
  }, [cursors, pageKey]);
  const nextCursor = entries.data?.nextCursor;
  const next = useCallback((): void => {
    if (nextCursor === undefined || nextCursor === null || entries.isError) return;
    setPagination({ key: pageKey, cursors: [...cursors, nextCursor] });
  }, [cursors, entries.isError, nextCursor, pageKey]);
  const create = useCallback((): void => {
    const target: MemoryEditorTarget = {
      entry: null,
      workspaceId,
      workspaceName,
      defaultScope: resolveMemoryScope(scopeValue, workspaceId),
    };
    if (modeFilter !== 'all') target.defaultMode = modeFilter;
    setEditor(target);
  }, [modeFilter, scopeValue, workspaceId, workspaceName]);
  const edit = useCallback(
    (entry: MemoryEntry): void => {
      setEditor({ entry, workspaceId, workspaceName });
    },
    [workspaceId, workspaceName],
  );
  const closeEditor = useCallback((): void => {
    setEditor(null);
  }, []);
  let workspaceError: string | null = null;
  if (sessionId !== null && session.isError) workspaceError = session.error.message;
  else if (workspaces.isError) workspaceError = workspaces.error.message;
  return {
    entries,
    settings,
    scopeValue,
    scopeOptions,
    workspaceError,
    workspacePending: sessionId !== null && session.isPending,
    editor,
    changeScope,
    modeFilter,
    view,
    changeView,
    profileCategory,
    changeProfileCategory,
    changeModeFilter,
    hasPrevious: cursors.length > 1,
    hasNext: !entries.isError && nextCursor !== undefined && nextCursor !== null,
    pageLabel: `第 ${cursors.length} 页`,
    previous,
    next,
    refresh,
    resetPage,
    create,
    edit,
    closeEditor,
    changeAllowUse,
    changeAllowLearning,
    updateSettings,
  };
};
