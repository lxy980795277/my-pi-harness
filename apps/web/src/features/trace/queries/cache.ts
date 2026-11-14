import type { ModelRequestDetail, TraceEntryDetail } from '@my-pi-harness/protocol';
import type { Query, QueryClient } from '@tanstack/react-query';

type TraceContent = ModelRequestDetail | TraceEntryDetail;

/** Unsettled request, tool and approval details need one final read when their execution ends. */
export const traceContentIsActive = (
  data: TraceContent | undefined,
  fallback = 'running',
): boolean => {
  let status = fallback;
  if (data !== undefined) {
    if ('summary' in data) status = data.summary.status;
    else status = data.entry.status;
  }
  return (
    status === 'running' ||
    status === 'executing' ||
    status === 'reviewing' ||
    status === 'awaiting_approval'
  );
};

const livePage = (query: Query): boolean => {
  return query.meta?.['traceLivePage'] === true;
};

const unsettledContent = (query: Query): boolean => {
  // The trace-content key is written only by the validated detail readers.
  return traceContentIsActive(query.state.data as TraceContent | undefined);
};

/** SSE refreshes the live first page and unsettled details; frozen pages and completed bodies stay static. */
export const refreshLiveTrace = async (client: QueryClient, sessionId?: string): Promise<void> => {
  const pageKey: string[] = ['trace'];
  const contentKey: string[] = ['trace-content'];
  if (sessionId !== undefined) {
    pageKey.push(sessionId);
    contentKey.push(sessionId);
  }
  await Promise.all([
    client.invalidateQueries({ queryKey: pageKey, predicate: livePage }),
    client.invalidateQueries({ queryKey: contentKey, predicate: unsettledContent }),
  ]);
};
