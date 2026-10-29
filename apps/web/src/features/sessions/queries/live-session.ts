import { SessionStreamUpdateSchema, type SessionSnapshot } from '@my-pi-harness/protocol';
import type { SessionConnectionStatus } from '@/features/sessions/types/session';

import { applySessionStreamUpdate } from '@/features/sessions/queries/session-stream';
import { subscribeSse } from '@/services/base-sse';
import { describeError } from '@/utils/describe-error';
import { parseResponse } from '@/utils/parse-response';

interface LiveSessionObserver {
  snapshot: (snapshot: SessionSnapshot) => void;
  connection: (status: SessionConnectionStatus, error: string | null) => void;
}

/** Owns parsing, bounded cache publication and gap recovery; cleanup discards unpublished old-target work. */
export const subscribeLiveSession = (id: string, observer: LiveSessionObserver): (() => void) => {
  let closed = false;
  let generation = 0;
  let closeSource = (): void => {
    return undefined;
  };
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let baselineTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: SessionSnapshot | undefined;
  let retryDelay = 100;

  const flush = (): void => {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!closed && pending) {
      const snapshot = pending;
      pending = undefined;
      observer.snapshot(snapshot);
    }
  };
  const connect = (): void => {
    reconnectTimer = undefined;
    if (closed) return;
    const ownedGeneration = ++generation;
    let current: SessionSnapshot | undefined;
    const recover = (failure: unknown): void => {
      if (closed || generation !== ownedGeneration) return;
      flush();
      generation++;
      clearTimeout(baselineTimer);
      closeSource();
      observer.connection('disconnected', describeError(failure));
      reconnectTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 2000);
    };
    const receive = (event: Event): void => {
      if (closed || generation !== ownedGeneration) return;
      try {
        if (
          !(event instanceof MessageEvent) ||
          typeof event.data !== 'string' ||
          event.data.length > 8 * 1024 * 1024
        ) {
          throw new Error('会话事件数据无效或超过上限。');
        }
        const parsed: unknown = JSON.parse(event.data);
        const update = parseResponse(SessionStreamUpdateSchema, parsed);
        let cursor: string;
        if (update.kind === 'snapshot')
          cursor = `${update.snapshot.snapshotSeq}:${update.snapshot.liveRevision}`;
        else cursor = `${update.snapshotSeq}:${update.liveRevision}`;
        if (event.lastEventId !== cursor) {
          throw new Error('会话事件游标与内容不一致。');
        }
        const next = applySessionStreamUpdate(current, update, id);
        if (next === current) return;
        current = next;
        pending = next;
        clearTimeout(baselineTimer);
        retryDelay = 100;
        observer.connection('connected', null);
        if (flushTimer === undefined) flushTimer = setTimeout(flush, 32);
      } catch (failure: unknown) {
        // Recover from a fresh baseline rather than applying a partial or overlapping interval.
        recover(failure);
      }
    };
    closeSource = subscribeSse(
      `/sessions/${encodeURIComponent(id)}/events`,
      'session.update',
      receive,
      (): void => {
        if (!closed && generation === ownedGeneration) {
          clearTimeout(baselineTimer);
          observer.connection('disconnected', null);
        }
      },
      (): void => {
        if (!closed && generation === ownedGeneration) {
          flush();
          current = undefined;
          observer.connection('connecting', null);
          clearTimeout(baselineTimer);
          baselineTimer = setTimeout((): void => {
            recover(new Error('未收到会话同步数据，正在重连；若持续发生，请重启本机服务。'));
          }, 5000);
        }
      },
    );
  };
  connect();
  return (): void => {
    closed = true;
    generation++;
    closeSource();
    clearTimeout(reconnectTimer);
    clearTimeout(flushTimer);
    clearTimeout(baselineTimer);
    pending = undefined;
  };
};
