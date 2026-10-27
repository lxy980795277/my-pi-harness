export { McpConnectionManager } from './manager.js';
export type { McpConnectionManagerOptions } from './manager.js';
export { McpError } from './errors.js';
export { compileMcpInputSchema } from './schema.js';
export { encodeMcpCatalog, decodeMcpCatalog } from './catalog-snapshot.js';
export { RemoteMcpManager, type RemoteMcpBinding, type RemoteMcpManagerOptions } from './remote.js';
export {
  RemoteOAuthSession,
  type RemoteOAuthStore,
  type RemoteOAuthOptions,
} from './remote-oauth.js';
export {
  createRemoteFetch,
  parseRemoteUrl,
  assertRemoteAddress,
  type RemoteNetworkOptions,
} from './remote-network.js';
export { SkillCatalog } from './skills/catalog.js';
export { SkillError } from './skills/errors.js';
export { downloadGitHubSkill } from './skills/github.js';
export { installSkillFiles } from './skills/install.js';
export { readSkillTree } from './skills/files.js';
export {
  BUILTIN_PLUGINS,
  BUILTIN_PLUGIN_APPS,
  BUILTIN_PLUGIN_RESOURCE_DIRECTORY,
} from './plugins/catalog.js';
export { loadBuiltinPluginApps, parseBuiltinPluginApps } from './plugins/apps.js';
export type { BuiltinPluginApp, OwnedBuiltinPluginApp } from './plugins/apps.js';
export { previewBuiltinPluginSkills, previewPluginSkills } from './plugins/preview.js';
export {
  PLUGIN_CONNECTION_DEFINITIONS,
  pluginConnectionDefinition,
  parsePluginConnectionManifest,
} from './plugins/connections.js';
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
export type { SkillRoot, SkillResourceContent } from './skills/types.js';
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
} from './types.js';

export { CONNECTION_PROVIDERS, connectionProvider } from './connections/providers.js';
export {
  beginConnectionOAuth,
  refreshConnectionOAuth,
  parseConnectionCredential,
  connectionFetch,
  type ConnectionCredential,
  type ConnectionOAuthFlow,
} from './connections/oauth.js';
export { syncSkillDirectory } from './skills/files.js';
export { LocalToolSearchEmbedder } from './search/local-embedder.js';
export type { LocalToolSearchEmbedderOptions } from './search/local-embedder.js';
