export { McpConnectionManager } from './mcp/manager';
export type { McpConnectionManagerOptions } from './mcp/manager';
export { McpError } from './mcp/errors';
export { NetworkError } from './network/errors';
export { PluginError } from './plugins/errors';
export { compileMcpInputSchema } from './mcp/schema';
export { encodeMcpCatalog, decodeMcpCatalog } from './mcp/catalog-snapshot';
export {
  RemoteMcpManager,
  type RemoteMcpBinding,
  type RemoteMcpManagerOptions,
} from './mcp/remote';
export {
  RemoteOAuthSession,
  type RemoteOAuthStore,
  type RemoteOAuthOptions,
} from './mcp/remote-oauth';
export { createRemoteFetch } from './network/remote-fetch';
export { parseRemoteUrl } from './network/remote-fetch';
export { parsePluginConnectionManifest } from './plugins/connections';
export type {
  PluginConnectionDefinition,
  PluginOAuthClient,
  PluginOAuthClients,
  PluginOAuthProfile,
} from './plugins/connections';
export { beginPluginOAuth, refreshPluginOAuth, pluginOAuthFetch } from './plugins/oauth';
export type { PluginOAuthTokens, PluginOAuthFlow, PluginOAuthFetch } from './plugins/oauth';
export { PluginOAuthError } from './plugins/oauth-errors';
export type { PluginOAuthPhase, PluginOAuthFailureReason } from './plugins/oauth-errors';
export type {
  McpCallInput,
  McpCallOutcome,
  McpCatalog,
  McpConnectionBinding,
  McpDiscoveredTool,
  McpLaunchInput,
  McpLaunchPreview,
  McpLease,
  McpResultContent,
  McpSecretDescriptor,
} from './mcp/types';

export { CONNECTION_PROVIDERS, connectionProvider } from './connections/providers';
export {
  beginConnectionOAuth,
  refreshConnectionOAuth,
  parseConnectionCredential,
  connectionFetch,
  type ConnectionCredential,
  type ConnectionOAuthFlow,
} from './connections/oauth';
export { LocalToolSearchEmbedder } from './search/local-embedder';
export type { LocalToolSearchEmbedderOptions } from './search/local-embedder';
