import type { LiveSession, SessionConnectionStatus } from '@/features/sessions/types/session';
import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { subscribeLiveSession } from '@/features/sessions/queries/live-session';
import { mergeSessionSnapshot, retainNewestSnapshot } from '@/features/sessions/queries/projection';
import { fetchSession } from '@/features/sessions/services/sessions';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface ConnectionState {
  id: string;
  status: SessionConnectionStatus;
  error: string | null;
}

/** HTTP and batched SSE share one monotonic cache; switching cancels the old subscription. */
export const useSession = (id: string): LiveSession => {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    id,
    status: 'connecting',
    error: null,
  });
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

  const { run: refreshWork } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: ['work', id] });
    }, [id, queryClient]),
  );

  useEffect(() => {
    let workTimer: ReturnType<typeof setTimeout> | undefined;
    const close = subscribeLiveSession(id, {
      snapshot: (snapshot): void => {
        mergeSessionSnapshot(queryClient, snapshot);
        if (workTimer === undefined) {
          workTimer = setTimeout((): void => {
            workTimer = undefined;
            refreshWork();
          }, 300);
        }
      },
      connection: (status, error): void => {
        setConnectionState((current): ConnectionState => {
          if (current.id === id && current.status === status && current.error === error) {
            return current;
          }
          return { id, status, error };
        });
      },
    });
    return (): void => {
      close();
      clearTimeout(workTimer);
    };
  }, [id, queryClient, refreshWork]);

  let connection: SessionConnectionStatus = 'connecting';
  let connectionError: string | null = null;
  if (connectionState.id === id) {
    connection = connectionState.status;
    connectionError = connectionState.error;
  }
  return { query, connection, connectionError };
};
