import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { createSessionUpdate } from './stream-update.js';

interface StreamResponse {
  readonly destroyed: boolean;
  write(record: string): boolean;
  end(): unknown;
  once(event: 'close' | 'drain', listener: () => void): unknown;
  off(event: 'close' | 'drain', listener: () => void): unknown;
  destroy(): unknown;
}

interface SessionStreamOptions {
  response: StreamResponse;
  snapshot: () => SessionSnapshot;
  subscribe: (changed: () => void) => () => void;
  authorized: () => boolean;
  watchAuthorization: (revoked: () => void) => () => void;
  onClose: () => void;
}

/** Owns one bounded SSE writer; slow sockets retain at most one record and one refresh marker. */
export const startSessionStream = (options: SessionStreamOptions): (() => void) => {
  const { response } = options;
  let stopped = false;
  let previous: SessionSnapshot | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;
  let changedWhileDraining = false;
  let unsubscribe = (): void => undefined;
  let unwatch = (): void => undefined;
  const releaseSubscriptions = (): void => {
    const stopSubscription = unsubscribe;
    const stopAuthorization = unwatch;
    unsubscribe = (): void => undefined;
    unwatch = (): void => undefined;
    stopSubscription();
    stopAuthorization();
  };
  const resume = (): void => {
    draining = false;
    clearTimeout(drainTimer);
    if (!stopped && changedWhileDraining) {
      changedWhileDraining = false;
      flushTimer = setTimeout(flush, 32);
    }
  };
  const awaitDrain = (): void => {
    draining = true;
    response.once('drain', resume);
    drainTimer = setTimeout(abort, 5000);
  };
  const heartbeat = setInterval(() => {
    try {
      if (!options.authorized()) {
        close();
        return;
      }
      if (!draining && !response.write(': heartbeat\n\n')) awaitDrain();
    } catch {
      // Authorization storage or a closed socket cannot sustain the private stream.
      abort();
    }
  }, 15_000);
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    releaseSubscriptions();
    clearTimeout(flushTimer);
    clearTimeout(drainTimer);
    clearInterval(heartbeat);
    response.off('drain', resume);
    response.off('close', cleanup);
    previous = undefined;
    options.onClose();
  };
  const abort = (): void => {
    if (stopped) return;
    cleanup();
    response.destroy();
  };
  const close = (): void => {
    if (stopped) return;
    const blocked = draining;
    cleanup();
    if (blocked) {
      response.destroy();
    } else {
      try {
        response.end();
      } catch {
        // An HTTP response that cannot finish must release its socket after owner cleanup.
        response.destroy();
      }
    }
  };
  const flush = (): void => {
    flushTimer = undefined;
    if (stopped) return;
    if (response.destroyed) {
      cleanup();
      return;
    }
    if (draining) {
      changedWhileDraining = true;
      return;
    }
    try {
      if (!options.authorized()) {
        close();
        return;
      }
      const current = options.snapshot();
      const update = createSessionUpdate(previous, current);
      if (!update) return;
      const record = `event: session.update\nid: ${current.snapshotSeq}\ndata: ${JSON.stringify(update)}\n\n`;
      if (Buffer.byteLength(record) > 8 * 1024 * 1024) {
        abort();
        return;
      }
      const ready = response.write(record);
      previous = current;
      // Node's writable high-water mark alone does not identify a slow client.
      if (!ready) awaitDrain();
    } catch {
      // An unreadable projection cannot provide a trustworthy continuation.
      abort();
    }
  };
  response.once('close', cleanup);
  try {
    // Subscription precedes the synchronous baseline read; commits cannot fall into a gap.
    unsubscribe = options.subscribe(() => {
      if (stopped) return;
      if (draining) {
        changedWhileDraining = true;
        return;
      }
      if (flushTimer === undefined) flushTimer = setTimeout(flush, 32);
    });
    unwatch = options.watchAuthorization(close);
    if (stopped) {
      releaseSubscriptions();
    } else {
      flush();
    }
  } catch {
    abort();
  }
  return close;
};
