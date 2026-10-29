import { AgentChangeSchema } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { subscribeSse } from '@/services/base-sse';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { parseResponse } from '@/utils/parse-response';
import { drainInvalidations, type RefreshOwner } from '@/utils/invalidation-refresh';

interface AgentRefreshOwner extends RefreshOwner {
  pendingReconnect: boolean;
}

/** One authorized workspace subscription refreshes active summaries and selected detail only. */
export const useAgentUpdates = (): boolean => {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const { run: refresh, cancel } = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, owner: AgentRefreshOwner): Promise<void> => {
        await drainInvalidations(signal, owner, async (): Promise<void> => {
          const reconnect = owner.pendingReconnect;
          owner.pendingReconnect = false;
          await Promise.all([
            client.invalidateQueries({ queryKey: ['agent-tasks'] }),
            client.invalidateQueries({ queryKey: ['agent-detail'] }),
            client.invalidateQueries({ queryKey: ['agent-board'] }),
          ]);
          if (owner.closed || signal.aborted) return;
          if (reconnect) await client.invalidateQueries({ queryKey: ['agent-settings'] });
        });
      },
      [client],
    ),
  );
  useEffect(() => {
    const owner: AgentRefreshOwner = { dirty: false, pendingReconnect: false, closed: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      timer = undefined;
      if (!owner.closed) refresh(owner);
    };
    const receive = (event: Event): void => {
      if (owner.closed) return;
      if (
        !(event instanceof MessageEvent) ||
        typeof event.data !== 'string' ||
        event.data.length > 1024
      )
        return;
      let reconnect: boolean;
      try {
        reconnect = parseResponse(AgentChangeSchema, JSON.parse(event.data)).kind === 'ready';
      } catch {
        setConnected(false);
        return;
      }
      setConnected(true);
      owner.dirty = true;
      owner.pendingReconnect ||= reconnect;
      if (reconnect) {
        clearTimeout(timer);
        // A timer also runs after the event bridge releases its previous async operation.
        timer = setTimeout(flush, 0);
        return;
      }
      if (timer === undefined) timer = setTimeout(flush, 300);
    };
    const disconnect = (): void => {
      if (!owner.closed) setConnected(false);
    };
    const close = subscribeSse('/agents/events', 'agents.changed', receive, disconnect);
    return (): void => {
      owner.closed = true;
      owner.dirty = false;
      owner.pendingReconnect = false;
      close();
      clearTimeout(timer);
      cancel();
    };
  }, [cancel, refresh]);
  return connected;
};
