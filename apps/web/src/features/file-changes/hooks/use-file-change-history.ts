import type { FileChangeBatchPage, FileChangeBatchQuery } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { fetchFileChangeBatches } from '@/features/file-changes/services/file-changes';
import { useFileChangesStore } from '@/features/file-changes/stores/file-changes';

interface FileChangeHistoryState {
  query: UseQueryResult<FileChangeBatchPage, Error>;
  select: (operationId: string) => void;
  previous: () => void;
  next: () => void;
  page: number;
}

/** Persisted summaries recover accepted operations after a browser reload. */
export const useFileChangeHistory = (sessionId: string): FileChangeHistoryState => {
  const [positions, setPositions] = useState<(number | undefined)[]>([undefined]);
  const inspect = useFileChangesStore((state) => {
    return state.inspect;
  });
  const input: FileChangeBatchQuery = { limit: 20 };
  const cursor = positions.at(-1);
  if (cursor !== undefined) input.cursor = cursor;
  const query = useQuery({
    queryKey: ['file-change-history', sessionId, input],
    queryFn: ({ signal }) => {
      return fetchFileChangeBatches(sessionId, input, signal);
    },
    gcTime: 0,
    refetchInterval: 2000,
  });
  const select = useCallback(
    (operationId: string): void => {
      inspect(sessionId, operationId);
    },
    [inspect, sessionId],
  );
  const previous = useCallback((): void => {
    setPositions((current) => {
      if (current.length <= 1) return current;
      return current.slice(0, -1);
    });
  }, []);
  const next = useCallback((): void => {
    if (query.data === undefined || query.data.nextCursor === null) return;
    const nextCursor = query.data.nextCursor;
    setPositions((current) => {
      return [...current, nextCursor];
    });
  }, [query.data]);
  return { query, select, previous, next, page: positions.length };
};
