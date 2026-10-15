import { QueryClientProvider } from '@tanstack/react-query';
import type { FC, PropsWithChildren } from 'react';
import { useApplicationQueryClient } from '@/app/hooks/use-query-client';

/** The browser cache belongs to the application instance, independently of the runtime. */
export const AppProviders: FC<PropsWithChildren> = ({ children }) => {
  const client = useApplicationQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
