import type { AuthStatus } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAttachmentDrafts } from '@/features/attachments/stores/attachment-drafts';
import { useCallback, useEffect, useState } from 'react';

import { fetchAuthStatus, logoutBrowser, pairBrowser } from '@/features/auth/services/auth';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useRequestTask } from '@/hooks/use-request-task';
import { subscribeAuthorizationLoss } from '@/services/base-request';

interface Authorization {
  query: UseQueryResult<AuthStatus, Error>;
  pair: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  revoked: boolean;
}

/** Owns local cookie authorization; private cache is erased on explicit logout. */
export const useAuthorization = (): Authorization => {
  const resetAttachmentDrafts = useAttachmentDrafts((state) => {
    return state.reset;
  });
  const queryClient = useQueryClient();
  const task = useRequestTask();
  const [revoked, setRevoked] = useState(false);
  const query = useQuery({
    queryKey: ['auth-status'],
    queryFn: ({ signal }): Promise<AuthStatus> => {
      return fetchAuthStatus(signal);
    },
    refetchInterval: 60_000,
  });

  const { run: refreshStatus } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    }, [queryClient]),
  );

  useEffect(() => {
    return subscribeAuthorizationLoss((): void => {
      setRevoked(true);
      refreshStatus();
    });
  }, [refreshStatus]);

  useEffect(() => {
    if (query.data?.authenticated === false) {
      resetAttachmentDrafts();
      queryClient.removeQueries({
        predicate: (cached): boolean => {
          return cached.queryKey[0] !== 'auth-status' && cached.queryKey[0] !== 'health';
        },
      });
    }
  }, [query.data?.authenticated, queryClient, resetAttachmentDrafts]);

  const pair = useCallback(
    async (code: string): Promise<void> => {
      const status = await task((signal): Promise<AuthStatus> => {
        return pairBrowser(code, signal);
      });
      queryClient.setQueryData(['auth-status'], status);
      setRevoked(false);
    },
    [queryClient, task],
  );

  const logout = useCallback(async (): Promise<void> => {
    setRevoked(true);
    try {
      await task(logoutBrowser);
    } catch (failure: unknown) {
      setRevoked(false);
      throw failure;
    }
    queryClient.clear();
    await queryClient.query({
      queryKey: ['auth-status'],
      queryFn: ({ signal }): Promise<AuthStatus> => {
        return fetchAuthStatus(signal);
      },
    });
  }, [queryClient, task]);

  return { query, pair, logout, revoked };
};
