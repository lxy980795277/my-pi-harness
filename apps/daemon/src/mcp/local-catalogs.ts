import type { McpConnectionBinding } from '@my-pi-harness/integrations';
import type {
  ApprovalMode,
  McpScope,
  McpScopeInput,
  McpServerView,
  ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import type { McpIdentity, ProfileStore, StoredMcpServer } from '@my-pi-harness/storage';
import { CatalogCache, type CatalogEntry } from './catalog-cache.js';
import { remoteFingerprint } from './remote-fingerprint.js';

export interface LocalCatalogEntry extends CatalogEntry {
  revision: number;
  accessEpoch: number;
  startupFingerprint: string;
}
interface Owner {
  require(id: string): StoredMcpServer;
  identity(): McpIdentity;
  connection(
    server: StoredMcpServer,
    scope: McpScope,
    signal: AbortSignal,
  ): Promise<McpConnectionBinding>;
  validate(binding: McpConnectionBinding): void;
  discover(id: string, input: McpScopeInput, signal: AbortSignal): Promise<unknown>;
}

/** Local preparation additionally checks the current workspace and executable identity before restore. */
export class LocalCatalogs extends CatalogCache<LocalCatalogEntry> {
  public constructor(
    private readonly store: ProfileStore,
    private readonly owner: Owner,
  ) {
    super(store.mcp.directory);
  }
  public authority(server: StoredMcpServer, scope: McpScope): string {
    return remoteFingerprint({
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      identity: this.owner.identity(),
      grant: this.store.mcp.grant(server.id, scope),
      secretBindings: server.secretBindings,
    });
  }
  public async prepareServer(id: string, scope: McpScope, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const server = this.owner.require(id);
    const key = `${id}:${scope}`;
    let binding: McpConnectionBinding | undefined;
    const prepared = (): McpConnectionBinding => {
      if (binding === undefined) throw new Error('MCP connection preparation has not completed');
      return binding;
    };
    const authority = this.authority(server, scope);
    await this.prepare(
      {
        key,
        serverId: id,
        scope,
        authority,
        before: async (owned) => {
          owned.throwIfAborted();
          binding = await this.owner.connection(server, scope, owned);
          owned.throwIfAborted();
        },
        assertCurrent: () => this.owner.validate(prepared()),
        restore: (value, discoveredAt) => ({
          authority,
          revision: server.revision,
          accessEpoch: server.accessEpoch,
          startupFingerprint: prepared().startupFingerprint,
          value,
          discoveredAt,
        }),
        discover: (owned) =>
          this.owner.discover(
            id,
            { scope, expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch },
            owned,
          ),
      },
      signal,
    );
  }
  public diagnostics(
    servers: readonly McpServerView[],
    workspaceId: string | null,
    approvalMode: ApprovalMode,
  ): readonly ToolDiscoveryDiagnostic[] {
    if (workspaceId === null) return [];
    const scope: McpScope = approvalMode === 'full-access' ? 'full-access' : 'sandboxed';
    return servers
      .filter((server) => server.enabled && server.workspaceId === workspaceId)
      .flatMap((server) =>
        server.trustedScopes
          .filter((trusted) => trusted === scope)
          .map((scope) => ({
            serverId: server.id,
            name: `${server.name} (${scope})`,
            ...this.state(`${server.id}:${scope}`),
            toolCount: this.get(`${server.id}:${scope}`)?.value.tools.length ?? 0,
          })),
      );
  }
}
