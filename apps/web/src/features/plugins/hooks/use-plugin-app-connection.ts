import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { McpToolCatalog, RemoteMcpView } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  fetchManagedMcpTools,
  setManagedTool,
  testSavedRemoteMcp,
} from '@/features/mcp/services/remote-mcp';
import { fetchPluginAuthorization } from '@/features/plugins/services/plugin-authorization';
import type {
  PluginAppAction,
  PluginAppConnectionState,
} from '@/features/plugins/types/plugin-app';
import { usePluginAppOAuth } from '@/features/plugins/hooks/use-plugin-app-oauth';

/** Installed official Apps use the plugin credential or an independent MCP authorization. */
export const usePluginAppConnection = (
  server: RemoteMcpView,
  pluginId: string,
  usesPluginOAuth: boolean,
  disabled: boolean,
): PluginAppConnectionState => {
  const client = useQueryClient();
  const authorization = useQuery({
    queryKey: ['skill-connections', pluginId],
    queryFn: ({ signal }) => {
      return fetchPluginAuthorization(pluginId, signal);
    },
    enabled: usesPluginOAuth,
  });
  const oauth = usePluginAppOAuth(server, usesPluginOAuth);
  let authorized = false;
  if (usesPluginOAuth) authorized = authorization.data?.isConnected === true;
  else if (server.oauth) authorized = server.oauthConnected;
  else
    authorized = server.secretHeaders.every((entry) => {
      return entry.configured;
    });
  const available = !disabled && server.enabled && server.trusted && authorized;
  const catalog = useQuery({
    queryKey: ['mcp', 'plugin-app-tools', server.id, server.revision, server.accessEpoch],
    queryFn: ({ signal }) => {
      return fetchManagedMcpTools(server.id, 'remote', 'sandboxed', signal);
    },
    enabled: available,
  });
  const refresh = useCallback(async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['mcp'] });
  }, [client]);
  const operation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, action: PluginAppAction): Promise<void> => {
        if (!available) return;
        try {
          if (action.type === 'refresh') await testSavedRemoteMcp(server, signal);
          else
            await setManagedTool(
              server.id,
              'remote',
              server.revision,
              server.accessEpoch,
              action.tool,
              action.tool.enabled === false,
              signal,
            );
        } finally {
          await refresh();
        }
      },
      [available, refresh, server],
    ),
  );
  let authDescription = '无需授权';
  if (usesPluginOAuth) {
    authDescription = '插件未授权或授权已失效，请返回插件详情重新授权。';
    if (authorized) authDescription = '正在使用插件授权，无需单独连接。';
  } else if (server.oauth) {
    authDescription = '需要完成 OAuth 授权后才能使用。';
    if (authorized) authDescription = 'OAuth 已授权';
  }
  let authLabel = '授权';
  if (oauth.waiting) authLabel = '等待授权';
  else if (authorized) authLabel = '重新授权';
  let error = operation.error ?? oauth.error;
  if (error === null && usesPluginOAuth && authorization.error !== null)
    error = authorization.error.message;
  if (error === null && catalog.error !== null) error = catalog.error.message;
  const { run } = operation;
  const reload = useCallback((): void => {
    run({ type: 'refresh' });
  }, [run]);
  let currentCatalog: McpToolCatalog | null = null;
  if (available) currentCatalog = catalog.data ?? null;
  const toolRows = (currentCatalog?.tools ?? []).map((tool) => {
    return {
      tool,
      change: (): void => {
        run({ type: 'tool', tool });
      },
    };
  });
  return {
    authDescription,
    authLabel,
    authorize: oauth.authorize,
    canAuthorize: !usesPluginOAuth && server.oauth && server.enabled && !disabled,
    canRefresh: available,
    refresh: reload,
    pending: operation.pending || oauth.pending || oauth.waiting,
    catalog: currentCatalog,
    toolRows,
    error,
  };
};
