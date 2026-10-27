import type { RemoteMcpView, SkillConnectionStatus } from '@my-pi-harness/protocol';
import type { PluginAppRow } from '@/features/plugins/types/plugin';

/** Plugin-owned credentials and a server's independent OAuth are different App settings. */
export const pluginAppAuthorizationLabel = (app: PluginAppRow, pluginName: string): string => {
  if (app.usesPluginOAuth) return `使用 ${pluginName} 插件授权`;
  if (app.server?.oauth) return 'OAuth';
  return '自动检测';
};

/** App transport reflects the installed server; the bundled catalog currently defaults to HTTP. */
export const pluginAppTransportLabel = (app: PluginAppRow): string => {
  if (app.server?.transport === 'sse') return 'SSE';
  return 'Streamable HTTP';
};

/** Plugin token status and independent MCP credentials are separate authorization sources. */
export const pluginAppConnectionLabel = (
  server: RemoteMcpView,
  authorization: SkillConnectionStatus | null,
  serviceAccountOnly = false,
): string => {
  if (!server.enabled) return '未开启';
  if (serviceAccountOnly) {
    if (authorization?.isConnected !== true) return '需要插件授权';
  } else if (server.oauth) {
    if (!server.oauthConnected) return '未授权';
  }
  if (
    server.secretHeaders.length > 0 &&
    server.secretHeaders.some((entry) => {
      return !entry.configured;
    })
  )
    return '未配置凭据';
  if (!server.trusted) return '需要重新开启';
  switch (server.catalogStatus) {
    case 'loading':
      return '正在发现工具';
    case 'ready':
      return '已连接';
    case 'error':
      return '工具发现失败';
    case 'idle':
      return '工具尚未就绪';
  }
};
