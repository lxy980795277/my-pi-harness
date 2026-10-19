import type { AuthStatus } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { useWorkspaceStore } from '@/app/stores/workspace';
import { useAttachmentDrafts } from '@/features/attachments/stores/attachment-drafts';
import { fetchAuthStatus, logoutBrowser, pairBrowser } from '@/features/auth/services/auth';
import { clearPrivateCache } from '@/features/auth/utils/private-cache';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useRequestTask } from '@/hooks/use-request-task';
import { subscribeAuthorizationCheck, subscribeAuthorizationLoss } from '@/services/base-request';

interface Authorization {
  query: UseQueryResult<AuthStatus, Error>;
  pair: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  receive: (status: AuthStatus) => void;
  revoked: boolean;
}

/** Owns application login and removes private state on expiry, logout or HTTP rejection. */
export const useAuthorization = (): Authorization => {
  const resetAttachments = useAttachmentDrafts((state) => {
    return state.reset;
  });
  const resetWorkspace = useWorkspaceStore((state) => {
    return state.reset;
  });
  const client = useQueryClient();
  const task = useRequestTask();
  const [revoked, setRevoked] = useState(false);
  const query = useQuery({
    queryKey: ['auth-status'],
    queryFn: ({ signal }): Promise<AuthStatus> => {
      return fetchAuthStatus(signal);
    },
    refetchInterval: 60_000,
  });
  const receive = useCallback(
    (status: AuthStatus): void => {
      client.setQueryData(['auth-status'], status);
      setRevoked(false);
    },
    [client],
  );
  const resetDrafts = useCallback((): void => {
    resetAttachments();
    resetWorkspace();
  }, [resetAttachments, resetWorkspace]);
  const { run: refresh } = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await client.cancelQueries({ queryKey: ['auth-status'] });
        const status = await client.query({
          queryKey: ['auth-status'],
          queryFn: ({ signal: querySignal }): Promise<AuthStatus> => {
            return fetchAuthStatus(AbortSignal.any([signal, querySignal]));
          },
          staleTime: 0,
        });
        signal.throwIfAborted();
        receive(status);
      },
      [client, receive],
    ),
  );
  const { run: clearCache } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await clearPrivateCache(client);
    }, [client]),
  );
  const revoke = useCallback((): void => {
    setRevoked(true);
    resetDrafts();
    clearCache();
    refresh();
  }, [clearCache, refresh, resetDrafts]);

  useEffect(() => {
    return subscribeAuthorizationLoss(revoke);
  }, [revoke]);
  useEffect(() => {
    return subscribeAuthorizationCheck(refresh);
  }, [refresh]);
  useEffect(() => {
    if (query.data && !query.data.authenticated) {
      resetDrafts();
      clearCache();
    }
  }, [clearCache, query.data, resetDrafts]);
  const expiresAt = query.data?.session?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) {
      return;
    }
    let timer: number;
    const checkExpiry = (): void => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        revoke();
        return;
      }
      timer = window.setTimeout(checkExpiry, Math.min(remaining, 60_000));
    };
    checkExpiry();
    return (): void => {
      window.clearTimeout(timer);
    };
  }, [expiresAt, revoke]);

  const pair = useCallback(
    async (code: string): Promise<void> => {
      const status = await task((signal): Promise<AuthStatus> => {
        return pairBrowser(code, signal);
      });
      receive(status);
    },
    [receive, task],
  );

  const logout = useCallback(async (): Promise<void> => {
    setRevoked(true);
    resetDrafts();
    await clearPrivateCache(client);
    try {
      await task(logoutBrowser);
      const status = await task(fetchAuthStatus);
      receive(status);
    } catch (failure: unknown) {
      refresh();
      throw failure;
    }
  }, [client, receive, refresh, resetDrafts, task]);

  return { query, pair, logout, receive, revoked };
};
