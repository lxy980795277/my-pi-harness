import type { FileChangeDetail, FileChangeDetailQuery } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { fetchFileChange } from '@/features/file-changes/services/file-changes';

interface FileChangeDetailState {
  query: UseQueryResult<FileChangeDetail, Error>;
  side: NonNullable<FileChangeDetailQuery['side']>;
  offset: number;
  changeSide: (side: string) => void;
  next: () => void;
  previous: () => void;
}

/** Pages recorded snapshots without accumulating a second unbounded copy of file contents. */
export const useFileChangeDetail = (sessionId: string, changeId: string): FileChangeDetailState => {
  const [side, setSide] = useState<NonNullable<FileChangeDetailQuery['side']>>('diff');
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets.at(-1) ?? 0;
  const queryInput: FileChangeDetailQuery = { side, offset, maxBytes: 60 * 1024 };
  const query = useQuery({
    queryKey: ['file-change-detail', sessionId, changeId, queryInput],
    queryFn: ({ signal }) => {
      return fetchFileChange(sessionId, changeId, queryInput, signal);
    },
    gcTime: 0,
  });
  const changeSide = useCallback((value: string): void => {
    if (value !== 'diff' && value !== 'before' && value !== 'after') return;
    setSide(value);
    setOffsets([0]);
  }, []);
  const next = useCallback((): void => {
    if (query.data === undefined || query.data.nextOffset === null) return;
    const nextOffset = query.data.nextOffset;
    setOffsets((current) => {
      return [...current, nextOffset];
    });
  }, [query.data]);
  const previous = useCallback((): void => {
    setOffsets((current) => {
      if (current.length <= 1) return current;
      return current.slice(0, -1);
    });
  }, []);
  return { query, side, offset, changeSide, next, previous };
};
