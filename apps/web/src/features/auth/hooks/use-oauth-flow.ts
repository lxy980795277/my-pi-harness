import type { OAuthFlowState } from '@/features/auth/types/auth';
import type { AuthFlow } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { cancelAuthFlow, fetchAuthFlow } from '@/features/auth/services/auth';
import { AUTH_STATUS_QUERY_KEY } from '@/features/auth/utils/authorization-status';
import { AUTH_STATUS_LABELS, oauthRefetchInterval } from '@/features/auth/utils/oauth-view';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { authorizationUrl } from '@/utils/authorization-url';
import { describeError } from '@/utils/describe-error';

/** Shared OAuth view mechanics; a provider dialog supplies its own completion and close policy. */
export const useOAuthFlow = (flowId: string, onCompleted?: () => void): OAuthFlowState => {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['auth-flow', flowId],
    queryFn: ({ signal }): Promise<AuthFlow> => {
      return fetchAuthFlow(flowId, signal);
    },
    refetchInterval: (state): number | false => {
      return oauthRefetchInterval(state.state.data);
    },
  });
  const { refetch: queryRefetch } = query;
  const complete = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await Promise.all([
          client.invalidateQueries({ queryKey: ['providers'] }),
          client.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
          client.invalidateQueries({ queryKey: ['auth-flows'] }),
        ]);
        signal.throwIfAborted();
        onCompleted?.();
      },
      [client, onCompleted],
    ),
  );
  const { run: completeRun } = complete;
  useEffect(() => {
    if (query.data?.status === 'completed') {
      completeRun();
    }
  }, [completeRun, query.data?.status]);
  const cancel = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await cancelAuthFlow(flowId, signal);
        await queryRefetch();
        await client.invalidateQueries({ queryKey: ['auth-flows'] });
      },
      [client, flowId, queryRefetch],
    ),
  );
  const open = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal): Promise<void> => {
        if (window.desktop) {
          await window.desktop.openAuth(flowId);
        }
      },
      [flowId],
    ),
  );
  const receive = useCallback(
    (flow: AuthFlow): void => {
      client.setQueryData(['auth-flow', flowId], flow);
    },
    [client, flowId],
  );
  let safeUrl: string | null = null;
  let urlError: string | null = null;
  if (query.data?.url) {
    try {
      safeUrl = authorizationUrl(query.data.url);
    } catch (failure: unknown) {
      urlError = describeError(failure);
    }
  }
  let statusLabel = '正在读取授权状态…';
  if (query.data) {
    statusLabel = AUTH_STATUS_LABELS[query.data.status];
  }
  let actionError = cancel.error;
  if (actionError === null) {
    actionError = open.error;
  }
  if (actionError === null) {
    actionError = complete.error;
  }
  return {
    query,
    flow: query.data,
    safeUrl,
    urlError,
    statusLabel,
    cancel: cancel.run,
    cancelPending: cancel.pending,
    actionError: actionError,
    openDesktop: open.run,
    desktop: window.desktop !== undefined,
    receive,
  };
};
