import type { Query, QueryClient } from '@tanstack/react-query';

import { AUTH_STATUS_QUERY_KEY } from '@/features/auth/utils/authorization-status';
import { HEALTH_QUERY_KEY } from '@/features/runtime/queries/health';

/** Public connection diagnostics and authorization state survive a private-session reset. */
export const isPrivateQuery = (query: Pick<Query, 'queryKey'>): boolean => {
  const publicHealth =
    query.queryKey.length === HEALTH_QUERY_KEY.length &&
    HEALTH_QUERY_KEY.every((part, index) => {
      return query.queryKey[index] === part;
    });
  return query.queryKey[0] !== AUTH_STATUS_QUERY_KEY[0] && !publicHealth;
};

/** Cancels old reads; retained diagnostics need a new protocol check after authorization changes. */
export const clearPrivateCache = async (client: QueryClient): Promise<void> => {
  await client.cancelQueries({ predicate: isPrivateQuery });
  await client.cancelQueries({ queryKey: HEALTH_QUERY_KEY, exact: true });
  client.removeQueries({ predicate: isPrivateQuery });
  await client.invalidateQueries({
    queryKey: HEALTH_QUERY_KEY,
    exact: true,
    refetchType: 'none',
  });
  client.getMutationCache().clear();
};
