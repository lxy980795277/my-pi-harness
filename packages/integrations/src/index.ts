export { McpConnectionManager } from './mcp/manager.js';
export type { McpConnectionManagerOptions } from './mcp/manager.js';
export { McpError } from './mcp/errors.js';
export { NetworkError } from './network/errors.js';
export { PluginError } from './plugins/errors.js';
export { compileMcpInputSchema } from './mcp/schema.js';
export { encodeMcpCatalog, decodeMcpCatalog } from './mcp/catalog-snapshot.js';
export {
  RemoteMcpManager,
  type RemoteMcpBinding,
  type RemoteMcpManagerOptions,
} from './mcp/remote.js';
export {
  RemoteOAuthSession,
  type RemoteOAuthStore,
  type RemoteOAuthOptions,
} from './mcp/remote-oauth.js';
export { createRemoteFetch } from './network/remote-fetch.js';
export { parseRemoteUrl } from './network/remote-fetch.js';
export { parsePluginConnectionManifest } from './plugins/connections.js';
export type {
  PluginConnectionDefinition,
  PluginOAuthClient,
  PluginOAuthClients,
  PluginOAuthProfile,
} from './plugins/connections.js';
export { beginPluginOAuth, refreshPluginOAuth, pluginOAuthFetch } from './plugins/oauth.js';
export type { PluginOAuthTokens, PluginOAuthFlow, PluginOAuthFetch } from './plugins/oauth.js';
export { PluginOAuthError } from './plugins/oauth-errors.js';
export type { PluginOAuthPhase, PluginOAuthFailureReason } from './plugins/oauth-errors.js';
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
} from './mcp/types.js';

export { CONNECTION_PROVIDERS, connectionProvider } from './connections/providers.js';
export {
  beginConnectionOAuth,
  refreshConnectionOAuth,
  parseConnectionCredential,
  connectionFetch,
  type ConnectionCredential,
  type ConnectionOAuthFlow,
} from './connections/oauth.js';
export { LocalToolSearchEmbedder } from './search/local-embedder.js';
export type { LocalToolSearchEmbedderOptions } from './search/local-embedder.js';
