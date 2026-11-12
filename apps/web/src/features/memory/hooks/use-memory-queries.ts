import type {
  MemoryListInput,
  MemoryPage,
  MemoryScope,
  MemoryUsage,
} from '@my-pi-harness/protocol';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  fetchMemoryPage,
  fetchMemorySettings,
  fetchMemoryUsage,
} from '@/features/memory/services/memory';
import { memoryScopeKey } from '@/features/memory/utils/memory-view';
import type { MemoryModeFilter } from '@/features/memory/types/memory';

export const MEMORY_SETTINGS_QUERY = queryOptions({
  queryKey: ['memory-settings'],
  queryFn: ({ signal }) => {
    return fetchMemorySettings(signal);
  },
});

/** A scope change gives the manager a separate cache and cancels the previous read. */
export const useMemoryPage = (
  scope: MemoryScope,
  mode: MemoryModeFilter,
  cursor: string | null,
  filter?: Pick<MemoryListInput, 'enabled' | 'category'>,
): UseQueryResult<MemoryPage, Error> => {
  let key: readonly unknown[] = ['memories', memoryScopeKey(scope), mode, cursor];
  if (filter !== undefined) key = [...key, filter];
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      const input: Omit<MemoryListInput, 'scope'> = { ...filter, limit: 20 };
      if (mode !== 'all') input.mode = mode;
      if (cursor !== null) input.cursor = cursor;
      return fetchMemoryPage(scope, input, signal);
    },
  });
};

/** The context dialog and child detail share one exact Run-owned adoption record. */
export const useMemoryUsage = (
  sessionId: string,
  runId: string | null,
  running: boolean,
): UseQueryResult<MemoryUsage | null, Error> => {
  return useQuery({
    queryKey: ['memory-usage', sessionId, runId],
    queryFn: ({ signal }) => {
      if (runId === null) throw new Error('尚无运行记录。');
      return fetchMemoryUsage(sessionId, runId, signal);
    },
    enabled: runId !== null,
    refetchInterval: running && 1500,
  });
};
