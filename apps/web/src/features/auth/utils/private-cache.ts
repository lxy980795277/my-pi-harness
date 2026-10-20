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

/** Cancels requests before removing their data so a late response cannot restore private cache. */
export const clearPrivateCache = async (client: QueryClient): Promise<void> => {
  await client.cancelQueries({ predicate: isPrivateQuery });
  client.removeQueries({ predicate: isPrivateQuery });
  client.getMutationCache().clear();
};
