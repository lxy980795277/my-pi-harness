import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type { McpCatalog } from '@my-pi-harness/integrations';
import type {
  McpControlInput,
  RemoteMcpView,
  ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import type {
  McpDirectoryRepository,
  McpIdentity,
  StoredRemoteMcpServer,
} from '@my-pi-harness/storage';
import { CatalogCache, type CatalogEntry } from './catalog-cache.js';
import { remoteFingerprint } from './remote-fingerprint.js';
import { pluginCredentialId, type ServiceCredentialAuthority } from './plugin-credentials.js';

export interface RemoteCatalogEntry extends CatalogEntry {
  revision: number;
  accessEpoch: number;
}
interface Owner {
  require(id: string): StoredRemoteMcpServer;
  identity(): McpIdentity;
  available(server: StoredRemoteMcpServer): boolean;
  assertAuthority(server: StoredRemoteMcpServer): void;
  connectionAuthority(server: StoredRemoteMcpServer): ServiceCredentialAuthority;
  discover(id: string, input: McpControlInput, signal: AbortSignal): Promise<unknown>;
}

/** Non-secret authority snapshots bind recovered remote catalogs to their current account and trust. */
export class RemoteCatalogs extends CatalogCache<RemoteCatalogEntry> {
  public constructor(
    repository: McpDirectoryRepository,
    private readonly owner: Owner,
    report?: (id: string) => void,
  ) {
    super(repository, report);
  }
  public authority(server: StoredRemoteMcpServer): string {
    return remoteFingerprint({
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      grant: server.grant,
      identity: this.owner.identity(),
      secrets: server.secretBindings,
      oauthCredentialRef: server.oauthCredentialRef,
      connection:
        server.connectionId !== undefined || pluginCredentialId(server) !== undefined
          ? this.owner.connectionAuthority(server)
          : null,
    });
  }
  private preparation(id: string) {
    const server = this.owner.require(id);
    this.owner.assertAuthority(server);
    const authority = this.authority(server);
    return {
      key: id,
      serverId: id,
      scope: 'remote',
      authority,
      assertCurrent: () => {
        const current = this.owner.require(id);
        this.owner.assertAuthority(current);
        if (this.authority(current) !== authority)
          throw new RuntimeError('MCP_CONFLICT', 'MCP目录准备期间授权已变化。');
      },
      restore: (value: McpCatalog, discoveredAt: number): RemoteCatalogEntry => ({
        authority,
        revision: server.revision,
        accessEpoch: server.accessEpoch,
        value,
        discoveredAt,
      }),
      discover: (signal: AbortSignal) =>
        this.owner.discover(
          id,
          {
            expectedRevision: server.revision,
            expectedAccessEpoch: server.accessEpoch,
          },
          signal,
        ),
    };
  }
  public async prepareServer(id: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    let plan;
    try {
      plan = this.preparation(id);
    } catch (error: unknown) {
      this.fail(id, error);
      return;
    }
    await this.prepare(plan, signal);
  }
  public startServer(id: string): void {
    const server = this.owner.require(id);
    if (!server.enabled || server.grant === null || !this.owner.available(server)) return;
    try {
      this.start(this.preparation(id));
    } catch (error: unknown) {
      this.fail(id, error);
    }
  }
  public currentState(id: string): Pick<ToolDiscoveryDiagnostic, 'status' | 'error'> {
    const state = this.state(id);
    if (state.status !== 'ready') return state;
    try {
      if (this.get(id)?.authority === this.authority(this.owner.require(id))) return state;
    } catch {
      /* Removed or revoked authority cannot expose a ready catalog. */
    }
    return { status: 'idle' };
  }
  public diagnostics(servers: readonly RemoteMcpView[]): readonly ToolDiscoveryDiagnostic[] {
    return servers
      .filter((server) => server.enabled && server.trusted)
      .map((server) => {
        const state = this.currentState(server.id);
        return {
          serverId: server.id,
          name: server.name,
          ...state,
          toolCount: state.status === 'ready' ? (this.get(server.id)?.value.tools.length ?? 0) : 0,
        };
      });
  }
}
