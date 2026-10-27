import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PluginView } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  disconnectPluginAuthorization,
  fetchPluginAuthorization,
  openPluginAuthorization,
} from '@/features/plugins/services/plugin-authorization';
import type {
  PluginAuthorizationState,
  PluginAuthorizationWindow,
} from '@/features/plugins/types/plugin-connection';

/** The marketplace polls while its authorization window remains open; the popup owns OAuth start. */
export const usePluginAuthorization = (plugin: PluginView): PluginAuthorizationState => {
  const client = useQueryClient();
  const [authorizationWindow, setAuthorizationWindow] = useState<PluginAuthorizationWindow | null>(
    null,
  );
  const waiting = authorizationWindow !== null;
  const status = useQuery({
    queryKey: ['skill-connections', plugin.manifest.id],
    queryFn: ({ signal }) => {
      return fetchPluginAuthorization(plugin.manifest.id, signal);
    },
    refetchInterval: () => {
      if (waiting) return 1000;
      return false;
    },
    refetchIntervalInBackground: true,
  });
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['skill-connections', plugin.manifest.id] }),
      client.invalidateQueries({ queryKey: ['mcp'] }),
    ]);
  }, [client, plugin.manifest.id]);
  const completed = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await refresh();
    }, [refresh]),
  );
  const { run: finish } = completed;
  const operation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (status.data?.isConnected) {
          await disconnectPluginAuthorization(plugin.manifest.id, signal);
          signal.throwIfAborted();
          await refresh();
          return;
        }
        const opened = await openPluginAuthorization(plugin, signal);
        signal.throwIfAborted();
        setAuthorizationWindow(opened);
      },
      [plugin, refresh, status.data?.isConnected],
    ),
  );
  useEffect(() => {
    if (authorizationWindow === null) return;
    if (status.data?.isConnected) {
      setAuthorizationWindow(null);
      finish();
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
  }, [authorizationWindow, finish, status.data?.isConnected]);
  const connected = status.data?.isConnected === true;
  let description = `未授权或授权已失效，请重新授权后使用 ${plugin.manifest.name}。`;
  if (status.isPending) description = '正在加载授权状态…';
  else if (connected) {
    let name = plugin.manifest.name;
    if (status.data?.account !== null && status.data?.account !== undefined)
      name = status.data.account.displayName ?? status.data.account.username;
    description = `已连接 ${name}`;
  }
  let label = '授权';
  if (connected) label = '断开授权';
  else if (waiting) label = '等待授权';
  let error = operation.error ?? completed.error;
  if (error === null && status.error !== null) error = status.error.message;
  return {
    description,
    connected,
    loading: status.isPending,
    waiting,
    pending: operation.pending,
    error,
    label,
    activate: operation.run,
  };
};
