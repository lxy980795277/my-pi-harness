import type { SessionArchiveJobsQuery, SessionArchiveJobsPage } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { fetchArchiveJobs } from '@/features/archives/services/archives';
import { useArchiveStore } from '@/features/archives/stores/archives';

interface ArchiveHistoryState {
  query: UseQueryResult<SessionArchiveJobsPage, Error>;
  select: (id: string) => void;
  previous: () => void;
  next: () => void;
  page: number;
}

/** Host history restores published import identities after browser and daemon restarts. */
export const useArchiveHistory = (): ArchiveHistoryState => {
  const [positions, setPositions] = useState<(string | undefined)[]>([undefined]);
  const select = useArchiveStore((state) => {
    return state.select;
  });
  const input: SessionArchiveJobsQuery = { limit: 20 };
  const cursor = positions.at(-1);
  if (cursor !== undefined) input.cursor = cursor;
  const query = useQuery({
    queryKey: ['archive-jobs', input],
    queryFn: ({ signal }) => {
      return fetchArchiveJobs(input, signal);
    },
    gcTime: 0,
    refetchInterval: 2000,
  });
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
