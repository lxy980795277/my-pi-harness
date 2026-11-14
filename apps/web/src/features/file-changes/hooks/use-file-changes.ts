import type { FileChangesPage, FileChangesQuery } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { fetchFileChanges } from '@/features/file-changes/services/file-changes';
import {
  useFileChangesStore,
  type FileChangeScope,
} from '@/features/file-changes/stores/file-changes';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface FileChangesState {
  query: UseQueryResult<FileChangesPage, Error>;
  scope: FileChangeScope;
  selectedIds: string[];
  changeId: string | null;
  select: (changeId: string | null) => void;
  toggle: (changeId: string) => void;
  showHistory: boolean;
  toggleHistory: () => void;
  close: () => void;
  changeOpen: (open: boolean) => void;
  back: () => void;
  previous: () => void;
  next: () => void;
  page: number;
  refresh: () => void;
}

/** Only the current bounded page is queried; selection persists across pages by change ID. */
export const useFileChanges = (sessionId: string): FileChangesState => {
  const client = useQueryClient();
  const scope = useFileChangesStore((state) => {
    return state.scope;
  });
  const positions = useFileChangesStore((state) => {
    return state.positions;
  });
  const selectedIds = useFileChangesStore((state) => {
    return state.selectedIds;
  });
  const changeId = useFileChangesStore((state) => {
    return state.changeId;
  });
  const showHistory = useFileChangesStore((state) => {
    return state.showHistory;
  });
  const setHistory = useFileChangesStore((state) => {
    return state.history;
  });
  const select = useFileChangesStore((state) => {
    return state.select;
  });
  const toggle = useFileChangesStore((state) => {
    return state.toggle;
  });
  const closeStore = useFileChangesStore((state) => {
    return state.close;
  });
  const nextStore = useFileChangesStore((state) => {
    return state.next;
  });
  const previous = useFileChangesStore((state) => {
    return state.previous;
  });
  const first = useFileChangesStore((state) => {
    return state.first;
  });
  const queryInput: FileChangesQuery = { ...scope, limit: 50 };
  const cursor = positions.at(-1);
  if (cursor !== undefined) queryInput.cursor = cursor;
  const query = useQuery({
    queryKey: ['file-changes', sessionId, queryInput],
    queryFn: ({ signal }) => {
      return fetchFileChanges(sessionId, queryInput, signal);
    },
    enabled: !showHistory,
    gcTime: 0,
    refetchInterval: 2000,
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
  const back = useCallback((): void => {
    select(null);
  }, [select]);
  const toggleHistory = useCallback((): void => {
    setHistory(!showHistory);
  }, [setHistory, showHistory]);
  const next = useCallback((): void => {
    if (query.data !== undefined && query.data.nextCursor !== null)
      nextStore(query.data.nextCursor);
  }, [nextStore, query.data]);
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      first();
      await client.invalidateQueries({ queryKey: ['file-changes', sessionId] });
      await client.invalidateQueries({ queryKey: ['file-change-history', sessionId] });
    }, [client, first, sessionId]),
  );
  return {
    query,
    scope,
    selectedIds,
    changeId,
    select,
    toggle,
    showHistory,
    toggleHistory,
    close,
    changeOpen,
    back,
    previous,
    next,
    page: positions.length,
    refresh: refresh.run,
  };
};
