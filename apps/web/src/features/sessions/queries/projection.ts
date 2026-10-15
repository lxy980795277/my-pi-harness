import type { SessionSnapshot, SessionSummary } from '@my-pi-harness/protocol';
import { replaceEqualDeep, type QueryClient } from '@tanstack/react-query';

/** Accepts HTTP and SSE facts in one place so an older refetch cannot erase live text. */
export const retainNewestSnapshot = (
  current: SessionSnapshot | undefined,
  incoming: SessionSnapshot,
): SessionSnapshot => {
  if (current && current.session.id !== incoming.session.id) {
    throw new Error('不能合并不同会话的状态。');
  }
  if (current && incoming.snapshotSeq <= current.snapshotSeq) {
    return current;
  }
  return replaceEqualDeep(current, incoming);
};

/** Installs a committed response into the same cache used by the live timeline. */
export const mergeSessionSnapshot = (queryClient: QueryClient, incoming: SessionSnapshot): void => {
  queryClient.setQueryData<SessionSnapshot>(['session', incoming.session.id], (current) => {
    return retainNewestSnapshot(current, incoming);
  });
  queryClient.setQueryData<SessionSummary[]>(['sessions'], (current) => {
    if (!current) {
      return current;
    }
    return current.map((session) => {
      if (session.id === incoming.session.id && session.snapshotSeq < incoming.snapshotSeq) {
        return incoming.session;
      }
      return session;
    });
  });
};
