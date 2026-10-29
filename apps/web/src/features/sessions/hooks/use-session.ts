import type { LiveSession, SessionConnectionStatus } from '@/features/sessions/types/session';
import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { subscribeLiveSession } from '@/features/sessions/queries/live-session';
import { mergeSessionSnapshot, retainNewestSnapshot } from '@/features/sessions/queries/projection';
import { fetchSession } from '@/features/sessions/services/sessions';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { drainInvalidations, type RefreshOwner } from '@/utils/invalidation-refresh';

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

  const { run: refreshWork, cancel } = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, owner: RefreshOwner): Promise<void> => {
        await drainInvalidations(signal, owner, async (): Promise<void> => {
          await queryClient.invalidateQueries({ queryKey: ['work', id] });
        });
      },
      [id, queryClient],
    ),
  );

  useEffect(() => {
    let workTimer: ReturnType<typeof setTimeout> | undefined;
    let workSequence = -1;
    let freshBaseline = true;
    const owner: RefreshOwner = { dirty: false, closed: false };
    const close = subscribeLiveSession(id, {
      snapshot: (snapshot): void => {
        if (owner.closed) return;
        mergeSessionSnapshot(queryClient, snapshot);
        const workChanged = freshBaseline || snapshot.snapshotSeq > workSequence;
        workSequence = Math.max(workSequence, snapshot.snapshotSeq);
        freshBaseline = false;
        if (!workChanged) return;
        owner.dirty = true;
        if (workTimer === undefined) {
          workTimer = setTimeout((): void => {
            workTimer = undefined;
            if (!owner.closed) refreshWork(owner);
          }, 300);
        }
      },
      connection: (status, error): void => {
        if (owner.closed) return;
        if (status === 'connecting') freshBaseline = true;
        setConnectionState((current): ConnectionState => {
          if (current.id === id && current.status === status && current.error === error) {
            return current;
          }
          return { id, status, error };
        });
      },
    });
    return (): void => {
      owner.closed = true;
      owner.dirty = false;
      close();
      clearTimeout(workTimer);
      cancel();
    };
  }, [cancel, id, queryClient, refreshWork]);

  let connection: SessionConnectionStatus = 'connecting';
  let connectionError: string | null = null;
  if (connectionState.id === id) {
    connection = connectionState.status;
    connectionError = connectionState.error;
  }
  return { query, connection, connectionError };
};
