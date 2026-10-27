import type { RemoteMcpManager } from '@my-pi-harness/integrations';
import type { ProfileStore, CredentialStore, RemoteMcpRepository } from '@my-pi-harness/storage';
import type { PluginTokenPort, ConnectionTokenPort } from './plugin-credentials.js';

export interface PluginRefreshDiagnostic {
  code: 'MCP_APP_DISCOVERY_FAILED';
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
  onBackgroundError?: (diagnostic: PluginRefreshDiagnostic) => void;
}
