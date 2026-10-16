import type { LiveSession, SessionConnectionStatus } from '@/features/sessions/types/session';
import { SessionSnapshotSchema, type SessionSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { mergeSessionSnapshot, retainNewestSnapshot } from '@/features/sessions/queries/projection';
import { fetchSession } from '@/features/sessions/services/sessions';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { subscribeSse } from '@/services/base-sse';
import { describeError } from '@/utils/describe-error';
import { parseResponse } from '@/utils/parse-response';

/** HTTP and batched SSE share one monotonic session cache; switching closes the old stream. */
export const useSession = (id: string): LiveSession => {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<SessionConnectionStatus>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['session', id],
    queryFn: ({ signal }): Promise<SessionSnapshot> => {
      return fetchSession(id, signal);
    },
    structuralSharing: (oldData, newData): SessionSnapshot => {
      return retainNewestSnapshot(
        oldData as SessionSnapshot | undefined,
        newData as SessionSnapshot,
      );
    },
  });

  const { run: recoverConnection } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth-status'] }),
        queryClient.invalidateQueries({ queryKey: ['session', id] }),
        queryClient.invalidateQueries({ queryKey: ['work', id] }),
      ]);
    }, [id, queryClient]),
  );

  const { run: refreshWork } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: ['work', id] });
    }, [id, queryClient]),
  );

  useEffect(() => {
    const cached = queryClient.getQueryData<SessionSnapshot>(['session', id]);
    let pending: SessionSnapshot | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let workTimer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
      flushTimer = undefined;
      if (pending) {
        mergeSessionSnapshot(queryClient, pending);
        pending = undefined;
        if (workTimer === undefined) {
          workTimer = setTimeout((): void => {
            workTimer = undefined;
            refreshWork();
          }, 300);
        }
      }
    };
    const close = subscribeSse(
      `/sessions/${encodeURIComponent(id)}/events?afterSeq=${cached?.snapshotSeq ?? 0}`,
      'session.snapshot',
      (event): void => {
        if (closed) {
          return;
        }
        try {
          if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
            throw new Error('事件数据无效。');
          }
          const parsed: unknown = JSON.parse(event.data);
          const snapshot = parseResponse(SessionSnapshotSchema, parsed);
          if (snapshot.session.id !== id || snapshot.snapshotSeq !== snapshot.session.snapshotSeq) {
            throw new Error('会话事件的标识或序号不一致。');
          }
          pending = retainNewestSnapshot(pending, snapshot);
          setConnection('connected');
          setConnectionError(null);
          if (flushTimer === undefined) {
            flushTimer = setTimeout(flush, 32);
          }
        } catch (failure: unknown) {
          setConnectionError(describeError(failure));
          setConnection('disconnected');
        }
      },
      (): void => {
        if (!closed) {
          setConnection('disconnected');
          recoverConnection();
        }
      },
      (): void => {
        if (!closed) {
          setConnection('connected');
          recoverConnection();
        }
      },
    );
    return (): void => {
      closed = true;
      close();
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
      }
      flush();
      if (workTimer !== undefined) {
        clearTimeout(workTimer);
      }
    };
  }, [id, queryClient, recoverConnection, refreshWork]);

  return { query, connection, connectionError };
};
