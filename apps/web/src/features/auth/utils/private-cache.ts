import type { Query, QueryClient } from '@tanstack/react-query';

/** Public connection diagnostics and authorization state survive a private-session reset. */
export const isPrivateQuery = (query: Pick<Query, 'queryKey'>): boolean => {
  return query.queryKey[0] !== 'auth-status' && query.queryKey[0] !== 'health';
};

/** Cancels requests before removing their data so a late response cannot restore private cache. */
export const clearPrivateCache = async (client: QueryClient): Promise<void> => {
  await client.cancelQueries({ predicate: isPrivateQuery });
  client.removeQueries({ predicate: isPrivateQuery });
  client.getMutationCache().clear();
};
