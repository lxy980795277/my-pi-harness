import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { fetchRemoteMcpServers } from '@/features/mcp/services/remote-mcp';
import { openPluginAppAuthorization } from '@/features/plugins/services/plugin-app-authorization';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { PluginAppOAuthState } from '@/features/plugins/types/plugin-app';
import type { PluginAuthorizationWindow } from '@/features/plugins/types/plugin-connection';

/** Independent App OAuth ends polling after authorization or when its launch window closes. */
export const usePluginAppOAuth = (
  server: RemoteMcpView | null,
  usesPluginOAuth: boolean,
): PluginAppOAuthState => {
  const [authorizationWindow, setAuthorizationWindow] = useState<PluginAuthorizationWindow | null>(
    null,
  );
  const waiting = authorizationWindow !== null;
  const status = useQuery({
    queryKey: ['mcp', 'remote-servers'],
    queryFn: ({ signal }) => {
      return fetchRemoteMcpServers(signal);
    },
    enabled: waiting && !usesPluginOAuth,
    refetchInterval: () => {
      if (waiting && !usesPluginOAuth) return 1000;
      return false;
    },
    refetchIntervalInBackground: true,
  });
  const operation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (server === null || !server.enabled || usesPluginOAuth) return;
        const opened = await openPluginAppAuthorization(server, signal);
        signal.throwIfAborted();
        setAuthorizationWindow(opened);
      },
      [server, usesPluginOAuth],
    ),
  );
  const latest = status.data?.find((entry) => {
    return entry.id === server?.id;
  });
  const connected = latest?.oauthConnected === true;
  useEffect(() => {
    if (authorizationWindow === null) return;
    if (connected || usesPluginOAuth || server === null || !server.enabled) {
      setAuthorizationWindow(null);
      return;
    }
    const timer = window.setInterval(() => {
      let closed = false;
      if (authorizationWindow.type === 'browser') closed = authorizationWindow.window.closed;
      else closed = authorizationWindow.expiresAt <= Date.now();
      if (closed) setAuthorizationWindow(null);
    }, 500);
    return (): void => {
      window.clearInterval(timer);
    };
  }, [authorizationWindow, connected, server, usesPluginOAuth]);
  let error = operation.error;
  if (error === null && waiting && status.error !== null) error = status.error.message;
  return { authorize: operation.run, waiting, pending: operation.pending, error };
};
