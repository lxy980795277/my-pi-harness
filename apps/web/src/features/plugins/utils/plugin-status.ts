import type { RemoteMcpView } from '@my-pi-harness/protocol';

/** Readiness describes saved startup and account facts, not an active network connection. */
export const pluginAppStatus = (server: RemoteMcpView | undefined, loading: boolean): string => {
  if (loading) return '正在读取配置';
  if (server === undefined) return '所属配置已移除';
  if (!server.trusted) return '等待启动授权';
  if (!server.enabled) return '已停用';
  if (server.oauth && !server.oauthConnected) return '等待账户连接';
  if (server.oauthConnected) return '启动已授权 · 账户已连接';
  return '启动已授权';
};
