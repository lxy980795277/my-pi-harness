import type { AuthStatus } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useWorkspaceStore } from '@/app/stores/workspace';
import { useAttachmentDrafts } from '@/features/attachments/stores/attachment-drafts';
import { logoutBrowser, pairBrowser } from '@/features/auth/services/auth';
import {
  AUTH_STATUS_QUERY_KEY,
  createAuthorizationStatus,
} from '@/features/auth/utils/authorization-status';
import { clearPrivateCache } from '@/features/auth/utils/private-cache';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useRequestTask } from '@/hooks/use-request-task';
import { subscribeAuthorizationCheck, subscribeAuthorizationLoss } from '@/services/base-request';

interface Authorization {
  query: UseQueryResult<AuthStatus, Error>;
  pair: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  reconnect: () => Promise<void>;
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
  const loggingOut = useRef(false);
  const [statusOwner] = useState(() => {
    return createAuthorizationStatus(client, (): void => {
      setRevoked(false);
    });
  });
  const query = useQuery({
    queryKey: AUTH_STATUS_QUERY_KEY,
    queryFn: ({ signal }): Promise<AuthStatus> => {
      return statusOwner.read(signal);
    },
    refetchInterval: 60_000,
  });
  const { run: receive } = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, status: AuthStatus): Promise<void> => {
        if (!loggingOut.current) {
          await statusOwner.receive(status, signal);
        }
      },
      [statusOwner],
    ),
  );
  const resetDrafts = useCallback((): void => {
    resetAttachments();
    resetWorkspace();
  }, [resetAttachments, resetWorkspace]);
  const { run: refresh } = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await statusOwner.refresh(signal);
      },
      [statusOwner],
    ),
  );
  const { run: clearCache } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await clearPrivateCache(client);
    }, [client]),
  );
  const { run: recover } = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, generation: number): Promise<void> => {
        await clearPrivateCache(client);
        await statusOwner.refresh(signal, generation);
      },
      [client, statusOwner],
    ),
  );
  const revoke = useCallback((): void => {
    if (statusOwner.isBlocked()) {
      return;
    }
    const generation = statusOwner.invalidate();
    setRevoked(true);
    resetDrafts();
    recover(generation);
  }, [recover, resetDrafts, statusOwner]);

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
      await task(async (signal): Promise<void> => {
        const status = await pairBrowser(code, signal);
        if (!loggingOut.current) {
          await statusOwner.receive(status, signal);
        }
      });
    },
    [statusOwner, task],
  );

  const reconnect = useCallback(async (): Promise<void> => {
    if (loggingOut.current) {
      return;
    }
    const generation = statusOwner.invalidate();
    await task(async (signal): Promise<void> => {
      await statusOwner.refresh(signal, generation);
    });
  }, [statusOwner, task]);

  const logout = useCallback(async (): Promise<void> => {
    loggingOut.current = true;
    const generation = statusOwner.invalidate();
    setRevoked(true);
    resetDrafts();
    try {
      await task(async (signal): Promise<void> => {
        await clearPrivateCache(client);
        await logoutBrowser(signal);
        await statusOwner.refresh(signal, generation);
      });
    } catch (failure: unknown) {
      recover(generation);
      throw failure;
    } finally {
      loggingOut.current = false;
    }
  }, [client, recover, resetDrafts, statusOwner, task]);

  return { query, pair, logout, reconnect, receive, revoked };
};
