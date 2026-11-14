import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ModelRequestDetail,
  ModelRequestDetailQuery,
  TraceEntry,
  TraceEntryDetail,
} from '@my-pi-harness/protocol';
import { useCallback, useState } from 'react';
import { fetchModelRequest, fetchTraceEntry } from '@/features/trace/services/trace';
import { entryFacts, requestFacts, type TraceFact } from '@/features/trace/utils/trace-view';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { traceContentIsActive } from '@/features/trace/queries/cache';

interface ContentPosition {
  cursor: number;
  offset: number;
}

interface TraceContentState {
  query: UseQueryResult<ModelRequestDetail | TraceEntryDetail, Error>;
  section: NonNullable<ModelRequestDetailQuery['section']>;
  changeSection: (value: string) => void;
  page: number;
  previous: () => void;
  next: () => void;
  retry: () => void;
  facts: TraceFact[];
  error: string | null;
}

const INITIAL_POSITION: ContentPosition = { cursor: 0, offset: 0 };

/** Text continuation keeps both item and character offsets, including within one large message. */
export const useTraceContent = (sessionId: string, entry: TraceEntry): TraceContentState => {
  const [section, setSection] =
    useState<NonNullable<ModelRequestDetailQuery['section']>>('messages');
  const [positions, setPositions] = useState<ContentPosition[]>([INITIAL_POSITION]);
  const position = positions.at(-1) ?? INITIAL_POSITION;
  const query = useQuery<ModelRequestDetail | TraceEntryDetail>({
    queryKey: ['trace-content', sessionId, entry.id, section, position],
    queryFn: ({ signal }) => {
      const input: ModelRequestDetailQuery = { section, ...position, limit: 10 };
      if (entry.modelRequestId !== null)
        return fetchModelRequest(sessionId, entry.modelRequestId, input, signal);
      return fetchTraceEntry(sessionId, entry.id, input, signal);
    },
    gcTime: 0,
    refetchInterval: (current): number | false => {
      if (traceContentIsActive(current.state.data, entry.status)) return 1000;
      return false;
    },
  });
  const changeSection = useCallback((value: string): void => {
    if (value !== 'system' && value !== 'messages' && value !== 'tools') return;
    setSection(value);
    setPositions([INITIAL_POSITION]);
  }, []);
  const previous = useCallback((): void => {
    setPositions((current) => {
      return current.slice(0, Math.max(1, current.length - 1));
    });
  }, []);
  const next = useCallback((): void => {
    const detail = query.data;
    if (detail === undefined || detail.nextCursor === null) return;
    const cursor = detail.nextCursor;
    setPositions((current) => {
      return [...current, { cursor, offset: detail.nextOffset ?? 0 }];
    });
  }, [query.data]);
  const { refetch } = query;
  const retry = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await refetch({ throwOnError: true });
    }, [refetch]),
  );
  let facts = entryFacts(entry);
  let error = entry.error;
  if (query.data !== undefined && 'summary' in query.data) {
    facts = requestFacts(query.data.summary);
    error = query.data.summary.error;
  }
  return {
    query,
    section,
    changeSection,
    page: positions.length,
    previous,
    next,
    retry: retry.run,
    facts,
    error,
  };
};
