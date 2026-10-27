import type { AuthStatus } from '@my-pi-harness/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { fetchAuthStatus } from '@/features/auth/services/auth';

interface AuthorizationStatus {
  read: (signal: AbortSignal) => Promise<AuthStatus>;
  /** Stops prior reads and gates passive checks until recovery or a new login is published. */
  invalidate: () => number;
  isBlocked: () => boolean;
  receive: (status: AuthStatus, signal: AbortSignal) => Promise<void>;
  /** An explicit generation permits only that transition's recovery read. */
  refresh: (signal: AbortSignal, generation?: number) => Promise<void>;
}

export const AUTH_STATUS_QUERY_KEY = ['auth-status'] as const;

/** Owns reads and publication of this renderer's application authorization. */
export const createAuthorizationStatus = (
  client: QueryClient,
  onReceived: () => void,
): AuthorizationStatus => {
  let generation = 0;
  let blocked = false;
  const reads = new Set<AbortController>();
  const invalidate = (): number => {
    generation += 1;
    blocked = true;
    for (const controller of reads) {
      controller.abort();
    }
    reads.clear();
    return generation;
  };
  const read = async (signal: AbortSignal, expected = generation): Promise<AuthStatus> => {
    signal.throwIfAborted();
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    reads.add(controller);
    try {
      const status = await fetchAuthStatus(requestSignal);
      requestSignal.throwIfAborted();
      if (expected !== generation) {
        throw new DOMException('Authorization check superseded', 'AbortError');
      }
      return status;
    } finally {
      reads.delete(controller);
    }
  };
  const publish = (status: AuthStatus): void => {
    blocked = false;
    client.setQueryData(AUTH_STATUS_QUERY_KEY, status);
    onReceived();
  };
  const receive = async (status: AuthStatus, signal: AbortSignal): Promise<void> => {
    const expected = invalidate();
    await client.cancelQueries({ queryKey: AUTH_STATUS_QUERY_KEY });
    signal.throwIfAborted();
    if (expected === generation) {
      publish(status);
    }
  };
  const refresh = async (signal: AbortSignal, recovery?: number): Promise<void> => {
    if (blocked && recovery === undefined) {
      return;
    }
    const expected = recovery ?? generation;
    if (expected !== generation) {
      return;
    }
    await client.cancelQueries({ queryKey: AUTH_STATUS_QUERY_KEY });
    signal.throwIfAborted();
    if (expected !== generation) {
      return;
    }
    try {
      const status = await client.query({
        queryKey: AUTH_STATUS_QUERY_KEY,
        queryFn: ({ signal: querySignal }): Promise<AuthStatus> => {
          return read(AbortSignal.any([signal, querySignal]), expected);
        },
        staleTime: 0,
      });
      signal.throwIfAborted();
      if (expected === generation) {
        publish(status);
      }
    } catch (failure: unknown) {
      if (expected !== generation || signal.aborted) {
        return;
      }
      throw failure;
    }
  };
  const readCurrent = (signal: AbortSignal): Promise<AuthStatus> => {
    if (blocked) {
      return Promise.reject(new DOMException('Authorization transition pending', 'AbortError'));
    }
    return read(signal);
  };
  const isBlocked = (): boolean => {
    return blocked;
  };
  return { read: readCurrent, invalidate, isBlocked, receive, refresh };
};
