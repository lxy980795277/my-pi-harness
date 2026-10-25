import { randomUUID } from 'node:crypto';
import { RemoteOAuthSession } from '@my-pi-harness/integrations';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type {
  ProfileStore,
  RemoteMcpRepository,
  StoredRemoteMcpServer,
  CredentialStore,
} from '@my-pi-harness/storage';
import type { McpControlInput } from '@my-pi-harness/protocol';
function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}
interface OAuthFlow {
  serverId: string;
  revision: number;
  accessEpoch: number;
  ownerId: string;
  identityEpoch: number;
  expiresAt: number;
  session: RemoteOAuthSession;
  controller: AbortController;
}
interface RemoteMcpOAuthOptions {
  store: ProfileStore;
  repository: RemoteMcpRepository;
  credentials: CredentialStore;
  fixtureOrigin?: string;
  require(id: string): StoredRemoteMcpServer;
  expected(server: StoredRemoteMcpServer, revision: number, epoch?: number): void;
  identity(): { ownerId: string; epoch: number };
  assertAuthority(server: StoredRemoteMcpServer): void;
  catalogChanged(id: string): void;
}
/** OAuth flows and refreshes are profile-owned, bounded and cancelled before credential storage closes. */
export class RemoteMcpOAuth {
  private readonly flows = new Map<string, OAuthFlow>();
  private readonly refreshes = new Map<string, Promise<string>>();
  private readonly operations = new Map<
    Promise<unknown>,
    { id: string; controller: AbortController }
  >();
  private closed = false;
  public constructor(private readonly options: RemoteMcpOAuthOptions) {}
  private track<T>(
    id: string,
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) fail('MCP_CLOSED', 'MCP OAuth服务正在关闭。');
    const controller = new AbortController();
    const task = operation(AbortSignal.any([signal, controller.signal]));
    this.operations.set(task, { id, controller });
    return task.finally(() => {
      this.operations.delete(task);
    });
  }
  public cancel(id: string): void {
    for (const [state, flow] of this.flows)
      if (flow.serverId === id) {
        this.flows.delete(state);
        flow.controller.abort();
      }
    for (const entry of this.operations.values()) if (entry.id === id) entry.controller.abort();
  }
  public beginOAuth(
    id: string,
    input: McpControlInput,
    redirectUrl: string,
    signal: AbortSignal,
  ): Promise<{ url: string; state: string; expiresAt: number }> {
    if ([...this.operations.values()].some((entry) => entry.id === id))
      fail('MCP_BUSY', '此服务器的OAuth操作正在进行，请完成或取消后重试。');
    this.cancel(id);
    return this.track(id, signal, (owned) => this.begin(id, input, redirectUrl, owned));
  }
  public completeOAuth(params: URLSearchParams, signal: AbortSignal): Promise<void> {
    const state = params.get('state');
    const flow = state === null ? undefined : this.flows.get(state);
    if (flow === undefined) fail('MCP_OAUTH_EXPIRED', 'OAuth流程已过期或已经使用。');
    return this.track(flow.serverId, signal, (owned) => this.complete(params, owned));
  }
  public async accessToken(server: StoredRemoteMcpServer, signal: AbortSignal): Promise<string> {
    let refresh = this.refreshes.get(server.id);
    if (refresh === undefined) {
      refresh = this.track(server.id, signal, async (owned) => {
        const session = await this.session(server, 'http://127.0.0.1/api/mcp/oauth/callback');
        return await session.accessToken(owned);
      });
      this.refreshes.set(server.id, refresh);
    }
    try {
      return await refresh;
    } finally {
      if (this.refreshes.get(server.id) === refresh) this.refreshes.delete(server.id);
    }
  }
  public stopAccepting(): void {
    this.closed = true;
    for (const flow of this.flows.values()) flow.controller.abort();
    this.flows.clear();
    for (const entry of this.operations.values()) entry.controller.abort();
  }
  public async close(): Promise<void> {
    this.stopAccepting();
    await Promise.allSettled([...this.operations.keys()]);
  }
  private async session(
    server: StoredRemoteMcpServer,
    redirectUrl: string,
  ): Promise<RemoteOAuthSession> {
    const ref = server.oauthCredentialRef ?? `mcp-oauth:${server.id}:${randomUUID()}`;
    let client:
      | {
          clientId: string;
          issuer: string;
          clientSecret?: string;
          scopes: string[];
          accessTypeOffline: boolean;
        }
      | undefined;
    if (server.oauthClient !== undefined) {
      if (server.oauthClient.clientSecret) {
        if (server.oauthClientSecretRef === null)
          fail('MCP_CREDENTIAL_REQUIRED', '请先配置OAuth Client Secret。');
        const secret = await this.options.credentials.read(server.oauthClientSecretRef);
        if (secret === undefined) fail('MCP_CREDENTIAL_REQUIRED', 'OAuth Client Secret不存在。');
        client = {
          clientId: server.oauthClient.clientId,
          issuer: server.oauthClient.issuer,
          scopes: server.oauthClient.scopes,
          accessTypeOffline: server.oauthClient.accessTypeOffline,
          clientSecret: secret,
        };
      } else {
        client = {
          clientId: server.oauthClient.clientId,
          issuer: server.oauthClient.issuer,
          scopes: server.oauthClient.scopes,
          accessTypeOffline: server.oauthClient.accessTypeOffline,
        };
      }
    }
    const session = new RemoteOAuthSession({
      endpoint: server.endpoint,
      redirectUrl,
      ...(client === undefined ? {} : { client }),
      ...(this.options.fixtureOrigin === undefined
        ? {}
        : { fixtureOrigin: this.options.fixtureOrigin }),
      store: {
        read: async () => await this.options.credentials.read(ref),
        write: async (value) => {
          this.options.expected(
            this.options.require(server.id),
            server.revision,
            server.accessEpoch,
          );
          await this.options.credentials.write(ref, value);
          let current: StoredRemoteMcpServer;
          try {
            current = this.options.require(server.id);
            this.options.expected(current, server.revision, server.accessEpoch);
            this.options.assertAuthority(current);
          } catch (error) {
            if (server.oauthCredentialRef === null) await this.options.credentials.delete(ref);
            throw error;
          }
          if (current.oauthCredentialRef === null)
            this.options.repository.save(
              { ...current, oauthCredentialRef: ref, updatedAt: Date.now() },
              current.revision,
              current.accessEpoch,
            );
        },
      },
    });
    await session.initialize();
    return session;
  }
  private async begin(
    id: string,
    input: McpControlInput,
    redirectUrl: string,
    signal: AbortSignal,
  ): Promise<{ url: string; state: string; expiresAt: number }> {
    const server = this.options.require(id);
    this.options.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    this.options.assertAuthority(server);
    if (!server.oauth) fail('MCP_OAUTH_DISABLED', '此服务器没有启用OAuth。');
    const identity = this.options.identity();
    const controller = new AbortController();
    const session = await this.session(server, redirectUrl);
    const result = await session.begin(AbortSignal.any([signal, controller.signal]));
    for (const [state, flow] of this.flows)
      if (flow.expiresAt < Date.now()) {
        flow.controller.abort();
        this.flows.delete(state);
      }
    if (this.flows.size >= 32) fail('MCP_OAUTH_LIMIT', '同时进行的OAuth流程超过限制。');
    const expiresAt = Date.now() + 600000;
    this.flows.set(result.state, {
      serverId: id,
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      ownerId: identity.ownerId,
      identityEpoch: identity.epoch,
      expiresAt,
      session,
      controller,
    });
    return { ...result, expiresAt };
  }
  private async complete(params: URLSearchParams, signal: AbortSignal): Promise<void> {
    const state = params.get('state');
    if (state === null) fail('MCP_OAUTH_STATE_INVALID', 'OAuth回调缺少state。');
    const flow = this.flows.get(state);
    this.flows.delete(state);
    if (flow === undefined || flow.expiresAt < Date.now())
      fail('MCP_OAUTH_EXPIRED', 'OAuth流程已过期或已经使用。');
    const server = this.options.require(flow.serverId);
    this.options.expected(server, flow.revision, flow.accessEpoch);
    this.options.assertAuthority(server);
    const identity = this.options.identity();
    if (identity.ownerId !== flow.ownerId || identity.epoch !== flow.identityEpoch)
      fail('MCP_OAUTH_STATE_INVALID', 'OAuth回调身份不匹配。');
    await flow.session.complete(params, AbortSignal.any([signal, flow.controller.signal]));
    const current = this.options.require(server.id);
    this.options.repository.save(
      { ...current, oauthConnected: true, updatedAt: Date.now() },
      current.revision,
      current.accessEpoch,
    );
    this.options.catalogChanged(server.id);
  }
}
