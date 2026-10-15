import { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/** Creates one private cache for this mounted browser application. */
export const useApplicationQueryClient = (): QueryClient => {
  const [client] = useState(() => {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      },
    });
  });
  return client;
};
