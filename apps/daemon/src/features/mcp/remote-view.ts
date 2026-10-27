import type { RemoteMcpView, ToolDiscoveryDiagnostic } from '@my-pi-harness/protocol';
import type { StoredRemoteMcpServer } from '@my-pi-harness/storage';

/** Public remote metadata excludes private credential references and token material. */
export function remoteMcpView(
  server: StoredRemoteMcpServer,
  pluginAvailable: boolean,
  state: Pick<ToolDiscoveryDiagnostic, 'status' | 'error'>,
): RemoteMcpView {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    endpoint: server.endpoint,
    publicHeaders: { ...server.publicHeaders },
    secretHeaders: server.secretHeaders.map((slot) => ({
      ...slot,
      configured: server.secretBindings.some(
        (binding) => binding.slotId === slot.slotId && binding.credentialRef !== null,
      ),
    })),
    oauth: server.oauth,
    ...(server.oauthClient === undefined ? {} : { oauthClient: server.oauthClient }),
    ...(server.connectionId === undefined ? {} : { connectionId: server.connectionId }),
    oauthClientSecretConfigured: server.oauthClientSecretRef !== null,
    revision: server.revision,
    accessEpoch: server.accessEpoch,
    enabled: server.enabled && pluginAvailable,
    trusted: server.grant !== null && pluginAvailable,
    oauthConnected: server.oauthConnected,
    catalogStatus: state.status,
    ...(state.error === undefined ? {} : { catalogError: state.error }),
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}
