export { McpConnectionManager } from './mcp/manager';
export type { McpConnectionManagerOptions } from './mcp/manager';
export { McpError } from './mcp/errors';
export { NetworkError } from './network/errors';
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
export type {
  McpCallInput,
  McpCallOutcome,
  McpCatalog,
  McpConnectionBinding,
  McpDiscoveredTool,
  McpLaunchInput,
  McpLaunchPreview,
  McpLease,
  McpSecretDescriptor,
} from './mcp/types';

export {
  beginConnectionOAuth,
  refreshConnectionOAuth,
  parseConnectionCredential,
  connectionFetch,
  type ConnectionCredential,
  type ConnectionOAuthFlow,
} from './connections/oauth';
export * from './oauth/index';
