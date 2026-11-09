import type { RemoteMcpManager } from '@my-pi-harness/integrations';
import type { ProfileStore, CredentialStore, RemoteMcpRepository } from '@my-pi-harness/storage';
import type { PluginTokenPort, ConnectionTokenPort } from './plugin-credentials';

export interface McpCatalogDiagnostic {
  code: 'MCP_DISCOVERY_FAILED';
  serverId: string;
}

export interface RemoteMcpServiceOptions {
  store: ProfileStore;
  repository: RemoteMcpRepository;
  credentials: CredentialStore;
  manager?: RemoteMcpManager;
  fixtureOrigin?: string;
  pluginToken?: PluginTokenPort;
  connectionToken?: ConnectionTokenPort;
  onDiscoveryError?: (diagnostic: McpCatalogDiagnostic) => void;
}
