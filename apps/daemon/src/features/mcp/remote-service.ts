import { createHash, randomUUID } from 'node:crypto';
import {
  RuntimeError,
  type ExternalTools,
  type ExternalToolCall,
  type ExternalToolOutcome,
  type FrozenMcpTool,
} from '@my-pi-harness/agent-runtime';
import {
  RemoteMcpManager,
  compileMcpInputSchema,
  type RemoteMcpBinding,
  type McpCatalog,
} from '@my-pi-harness/integrations';
import type {
  ApprovalMode,
  RemoteMcpInput,
  RemoteMcpUpdate,
  RemoteMcpView,
  RemoteMcpTrustInput,
  RemoteMcpTrustPreview,
  McpControlInput,
  McpSecretInput,
  McpToolSelection,
  McpToolCatalog,
  McpScope,
  McpMetadata,
  McpToolControl,
  McpReadOnlyGrantView,
  McpToolControlInput,
  McpReadOnlyGrantInput,
  RemoteMcpDraftTestInput,
  RemoteMcpDraftTestResult,
} from '@my-pi-harness/protocol';
import type {
  ProfileStore,
  CredentialStore,
  RemoteMcpRepository,
  StoredRemoteMcpServer,
} from '@my-pi-harness/storage';

import { RemoteMcpOAuth } from './remote-oauth.js';
import { McpDirectoryPolicy, mcpMetadata } from './directory.js';
import { assertRemoteNameAvailable, validateRemoteInput } from './remote-configuration.js';
import { testRemoteMcpDraft } from './remote-connection-test.js';
interface CatalogEntry {
  revision: number;
  accessEpoch: number;
  value: McpCatalog;
  discoveredAt: number;
}
export interface RemoteMcpServiceOptions {
  store: ProfileStore;
  repository: RemoteMcpRepository;
  credentials: CredentialStore;
  manager?: RemoteMcpManager;
  fixtureOrigin?: string;
  connectionToken?: {
    authority(
      connectionId: string,
      endpoint: string,
    ): { connectionId: string; accessEpoch: number; ownerId: string; identityEpoch: number };
    read(connectionId: string, endpoint: string, signal: AbortSignal): Promise<string>;
  };
}
function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}
function hash(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, entry: unknown) =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
          : entry,
      ),
    )
    .digest('hex');
}
function alias(id: string, name: string): string {
  return `mcp_${hash(id).slice(0, 16)}_${hash(name).slice(0, 32)}`;
}
/** Profile-scoped remote authority is independent from application login cookies and local workspaces. */
export class RemoteMcpService implements ExternalTools {
  private readonly manager: RemoteMcpManager;
  private readonly directory: McpDirectoryPolicy;
  private readonly catalogs = new Map<string, CatalogEntry>();
  private readonly oauth: RemoteMcpOAuth;
  private readonly mutations = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  public constructor(private readonly options: RemoteMcpServiceOptions) {
    this.manager =
      options.manager ??
      new RemoteMcpManager({
        ...(options.fixtureOrigin === undefined ? {} : { fixtureOrigin: options.fixtureOrigin }),
      });
    this.directory = new McpDirectoryPolicy(options.store, {
      server: (id) => this.require(id),
      identity: () => this.identity(),
      catalogs: (id) => {
        const entry = this.catalogs.get(id);
        return entry === undefined ? [] : [entry.value];
      },
      invalidate: (id) => this.manager.invalidateServer(id),
      assert: (tools) => this.assertBindingsCurrent(tools),
    });
    this.oauth = new RemoteMcpOAuth({
      ...options,
      require: (id) => this.require(id),
      expected: (server, revision, epoch) => this.expected(server, revision, epoch),
      identity: () => this.identity(),
      assertAuthority: (server) => this.assertAuthority(server),
      catalogChanged: (id) => this.catalogs.delete(id),
    });
  }
  private identity() {
    const owner = this.options.store.auth.profileOwner();
    if (owner === undefined) fail('MCP_IDENTITY_REQUIRED', '请先登录后管理远程MCP。');
    return this.options.store.mcp.identity(owner.id);
  }
  private require(id: string): StoredRemoteMcpServer {
    if (this.closed) fail('MCP_CLOSED', 'MCP服务正在关闭。');
    const server = this.options.repository.get(id);
    if (server === undefined) fail('MCP_SERVER_NOT_FOUND', '远程MCP服务器不存在。');
    return server;
  }
  private expected(server: StoredRemoteMcpServer, revision: number, epoch?: number): void {
    if (server.revision !== revision || (epoch !== undefined && server.accessEpoch !== epoch))
      fail('MCP_CONFLICT', '远程MCP配置或授权已变化，请刷新后重试。');
  }
  private validate(input: RemoteMcpInput): RemoteMcpInput {
    return validateRemoteInput(input, this.options.fixtureOrigin);
  }
  private fingerprint(server: StoredRemoteMcpServer): string {
    return hash({
      endpoint: server.endpoint,
      transport: server.transport,
      publicHeaders: server.publicHeaders,
      secretHeaders: server.secretHeaders,
      oauth: server.oauth,
      oauthClient: server.oauthClient,
      connectionId: server.connectionId,
    });
  }
  private view(server: StoredRemoteMcpServer): RemoteMcpView {
    const pluginAvailable = this.pluginAvailable(server);
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
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }
  public list(): RemoteMcpView[] {
    if (this.closed) fail('MCP_CLOSED', 'MCP服务正在关闭。');
    return this.options.repository.list().map((server) => this.view(server));
  }
  public owns(id: string): boolean {
    return this.options.repository.get(id) !== undefined;
  }
  public ownedBy(id: string, pluginId: string, componentId: string): boolean {
    const owner = this.require(id).pluginOwner;
    return owner?.pluginId === pluginId && owner.componentId === componentId;
  }
  private pluginAvailable(server: StoredRemoteMcpServer): boolean {
    const owner = server.pluginOwner;
    if (owner === undefined) return true;
    const plugin = this.options.store.extensions
      .plugins()
      .find((entry) => entry.id === owner.pluginId);
    return (
      plugin?.enabled === true &&
      plugin.components.some(
        (entry) =>
          entry.id === owner.componentId &&
          entry.kind === 'app' &&
          entry.enabled &&
          entry.referenceId === server.id,
      )
    );
  }
  public get(id: string): RemoteMcpView {
    return this.view(this.require(id));
  }
  public prepareInput(input: RemoteMcpInput): RemoteMcpInput {
    this.identity();
    return this.validate(input);
  }
  public create(
    input: RemoteMcpInput,
    pluginOwner?: { pluginId: string; componentId: string },
  ): RemoteMcpView {
    this.identity();
    const config = this.validate(input);
    assertRemoteNameAvailable(this.options.repository.list(), config.name);
    const now = Date.now();
    return this.view(
      this.options.repository.save(
        {
          ...config,
          ...(pluginOwner === undefined ? {} : { pluginOwner }),
          id: randomUUID(),
          revision: 1,
          accessEpoch: 1,
          enabled: false,
          grant: null,
          oauthCredentialRef: null,
          oauthClientSecretRef: null,
          oauthConnected: false,
          secretBindings: config.secretHeaders.map((slot) => ({
            ...slot,
            credentialRef: null,
            epoch: 1,
          })),
          createdAt: now,
          updatedAt: now,
        },
        null,
      ),
    );
  }
  private async mutate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.mutations.has(id) || this.manager.hasActiveLeases(id))
      fail('MCP_BUSY', '此远程服务器正在使用。');
    this.mutations.add(id);
    const task = operation();
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.mutations.delete(id);
      this.pending.delete(task);
    }
  }
  public async update(id: string, input: RemoteMcpUpdate): Promise<RemoteMcpView> {
    return await this.mutate(id, async () => {
      const server = this.require(id);
      this.expected(server, input.expectedRevision);
      const config = this.validate({
        name: input.name,
        transport: input.transport,
        endpoint: input.endpoint,
        publicHeaders: input.publicHeaders,
        secretHeaders: input.secretHeaders,
        oauth: input.oauth,
        ...(input.oauthClient === undefined ? {} : { oauthClient: input.oauthClient }),
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      });
      assertRemoteNameAvailable(this.options.repository.list(), config.name, id);
      const sameTarget =
        config.endpoint === server.endpoint && config.transport === server.transport;
      const next: StoredRemoteMcpServer = {
        ...server,
        ...config,
        revision: server.revision + 1,
        accessEpoch: server.accessEpoch + 1,
        enabled: false,
        grant: null,
        oauthCredentialRef: null,
        oauthClientSecretRef: null,
        oauthConnected: false,
        secretBindings: config.secretHeaders.map((slot) => {
          const previous = server.secretBindings.find(
            (entry) =>
              entry.slotId === slot.slotId &&
              entry.headerName.toLowerCase() === slot.headerName.toLowerCase(),
          );
          if (sameTarget && previous !== undefined)
            return { ...slot, credentialRef: previous.credentialRef, epoch: previous.epoch };
          return { ...slot, credentialRef: null, epoch: 1 };
        }),
        updatedAt: Date.now(),
      };
      if (config.connectionId === undefined) delete next.connectionId;
      if (config.oauthClient === undefined) delete next.oauthClient;
      const saved = this.options.repository.save(next, server.revision, server.accessEpoch);
      this.catalogs.delete(id);
      this.cancelFlows(id);
      const retained = new Set(
        saved.secretBindings.map((slot) => slot.credentialRef).filter((ref) => ref !== null),
      );
      await this.deleteCredentials(server, retained);
      return this.view(saved);
    });
  }
  private cancelFlows(id: string): void {
    this.oauth.cancel(id);
  }
  private async deleteCredentials(
    server: StoredRemoteMcpServer,
    retained: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    for (const ref of [
      ...server.secretBindings.map((slot) => slot.credentialRef),
      server.oauthCredentialRef,
      server.oauthClientSecretRef,
    ])
      if (ref !== null && !retained.has(ref)) await this.options.credentials.delete(ref);
  }
  public async remove(id: string, expectedRevision: number): Promise<void> {
    await this.mutate(id, async () => {
      const server = this.require(id);
      this.expected(server, expectedRevision);
      this.options.repository.remove(id, expectedRevision);
      this.options.store.mcp.directory.remove(id);
      this.catalogs.delete(id);
      this.cancelFlows(id);
      await this.deleteCredentials(server);
    });
  }
  public preview(id: string, input: McpControlInput): RemoteMcpTrustPreview {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    this.identity();
    if (!this.pluginAvailable(server)) fail('MCP_PLUGIN_DISABLED', '所属插件或服务组件未启用。');
    this.validate(server);
    return {
      serverId: id,
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      endpoint: server.endpoint,
      transport: server.transport,
      headerNames: [
        ...Object.keys(server.publicHeaders),
        ...server.secretHeaders.map((slot) => slot.headerName),
      ],
      fingerprint: this.fingerprint(server),
    };
  }
  public trust(id: string, input: RemoteMcpTrustInput): RemoteMcpView {
    const preview = this.preview(id, input);
    if (preview.fingerprint !== input.fingerprint)
      fail('MCP_CONFLICT', '远端地址或授权范围已变化。');
    const server = this.require(id);
    const identity = this.identity();
    return this.view(
      this.options.repository.save(
        {
          ...server,
          enabled: true,
          grant: {
            id: randomUUID(),
            ownerId: identity.ownerId,
            identityEpoch: identity.epoch,
            fingerprint: preview.fingerprint,
          },
          updatedAt: Date.now(),
        },
        server.revision,
        server.accessEpoch,
      ),
    );
  }
  public async disable(id: string, input: McpControlInput): Promise<RemoteMcpView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const saved = this.options.repository.save(
      {
        ...server,
        enabled: false,
        grant: null,
        accessEpoch: server.accessEpoch + 1,
        updatedAt: Date.now(),
      },
      server.revision,
      server.accessEpoch,
    );
    this.catalogs.delete(id);
    this.cancelFlows(id);
    await this.manager.invalidateServer(id);
    return this.view(saved);
  }
  public async writeSecret(
    id: string,
    slotId: string,
    input: McpSecretInput,
  ): Promise<RemoteMcpView> {
    return await this.mutate(id, async () => {
      const server = this.require(id);
      this.expected(server, input.expectedRevision);
      const slot = server.secretBindings.find((entry) => entry.slotId === slotId);
      if (slot === undefined) fail('MCP_SECRET_NOT_FOUND', '秘密槽位不存在。');
      if (/[\r\n\0]/.test(input.value)) fail('MCP_HEADER_INVALID', '秘密请求头不能包含控制字符。');
      const ref = `mcp-remote:${id}:${randomUUID()}`;
      let saved: StoredRemoteMcpServer;
      try {
        await this.options.credentials.write(ref, input.value);
        this.expected(this.require(id), server.revision, server.accessEpoch);
        saved = this.options.repository.save(
          {
            ...server,
            revision: server.revision + 1,
            accessEpoch: server.accessEpoch + 1,
            enabled: false,
            grant: null,
            secretBindings: server.secretBindings.map((entry) =>
              entry.slotId === slotId
                ? { ...entry, credentialRef: ref, epoch: entry.epoch + 1 }
                : entry,
            ),
            updatedAt: Date.now(),
          },
          server.revision,
          server.accessEpoch,
        );
      } catch (error) {
        await this.options.credentials.delete(ref);
        if (error instanceof RuntimeError) throw error;
        fail('MCP_CREDENTIAL_WRITE_FAILED', '系统凭据保存失败，配置未生效。');
      }
      this.catalogs.delete(id);
      this.cancelFlows(id);
      if (slot.credentialRef !== null) await this.options.credentials.delete(slot.credentialRef);
      return this.view(saved);
    });
  }
  public async deleteSecret(
    id: string,
    slotId: string,
    input: McpControlInput,
  ): Promise<RemoteMcpView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const slot = server.secretBindings.find((entry) => entry.slotId === slotId);
    if (slot === undefined) fail('MCP_SECRET_NOT_FOUND', '秘密槽位不存在。');
    const saved = this.options.repository.save(
      {
        ...server,
        revision: server.revision + 1,
        accessEpoch: server.accessEpoch + 1,
        enabled: false,
        grant: null,
        secretBindings: server.secretBindings.map((entry) =>
          entry.slotId === slotId
            ? { ...entry, credentialRef: null, epoch: entry.epoch + 1 }
            : entry,
        ),
        updatedAt: Date.now(),
      },
      server.revision,
      server.accessEpoch,
    );
    this.cancelFlows(id);
    this.catalogs.delete(id);
    await this.manager.invalidateServer(id);
    if (slot.credentialRef !== null) await this.options.credentials.delete(slot.credentialRef);
    return this.view(saved);
  }
  public async deleteOAuthClientSecret(id: string, input: McpControlInput): Promise<RemoteMcpView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const saved = this.options.repository.save(
      {
        ...server,
        revision: server.revision + 1,
        accessEpoch: server.accessEpoch + 1,
        enabled: false,
        grant: null,
        oauthClientSecretRef: null,
        oauthCredentialRef: null,
        oauthConnected: false,
        updatedAt: Date.now(),
      },
      server.revision,
      server.accessEpoch,
    );
    this.cancelFlows(id);
    this.catalogs.delete(id);
    await this.manager.invalidateServer(id);
    for (const ref of [server.oauthClientSecretRef, server.oauthCredentialRef])
      if (ref !== null) await this.options.credentials.delete(ref);
    return this.view(saved);
  }
  private assertAuthority(server: StoredRemoteMcpServer): void {
    const identity = this.identity();
    if (
      !server.enabled ||
      !this.pluginAvailable(server) ||
      server.grant === null ||
      server.grant.ownerId !== identity.ownerId ||
      server.grant.identityEpoch !== identity.epoch ||
      server.grant.fingerprint !== this.fingerprint(server) ||
      this.mutations.has(server.id)
    )
      fail('MCP_DISABLED', '请先确认远程地址和认证范围。');
  }
  public beginOAuth(
    id: string,
    input: McpControlInput,
    redirectUrl: string,
    signal: AbortSignal,
  ): Promise<{ url: string; state: string; expiresAt: number }> {
    return this.oauth.beginOAuth(id, input, redirectUrl, signal);
  }
  public completeOAuth(params: URLSearchParams, signal: AbortSignal): Promise<void> {
    return this.oauth.completeOAuth(params, signal);
  }
  public async disconnectOAuth(id: string, input: McpControlInput): Promise<RemoteMcpView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const next = this.options.repository.save(
      {
        ...server,
        accessEpoch: server.accessEpoch + 1,
        enabled: false,
        grant: null,
        oauthCredentialRef: null,
        oauthConnected: false,
        updatedAt: Date.now(),
      },
      server.revision,
      server.accessEpoch,
    );
    this.cancelFlows(id);
    this.catalogs.delete(id);
    await this.manager.invalidateServer(id);
    if (server.oauthCredentialRef !== null)
      await this.options.credentials.delete(server.oauthCredentialRef);
    return this.view(next);
  }
  private async binding(
    server: StoredRemoteMcpServer,
    signal: AbortSignal,
  ): Promise<RemoteMcpBinding> {
    this.assertAuthority(server);
    const headers = { ...server.publicHeaders };
    const secrets: string[] = [];
    for (const slot of server.secretBindings) {
      if (slot.credentialRef === null) fail('MCP_CREDENTIAL_REQUIRED', '请先配置所有秘密请求头。');
      const value = await this.options.credentials.read(slot.credentialRef);
      if (value === undefined) fail('MCP_CREDENTIAL_REQUIRED', '系统凭据不存在，请重新配置。');
      headers[slot.headerName] = value;
      secrets.push(value);
      if (slot.headerName.toLowerCase() === 'authorization') {
        const token = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value)?.[1];
        if (token !== undefined) secrets.push(token);
      }
    }
    if (server.connectionId !== undefined) {
      const tokenPort = this.options.connectionToken;
      if (tokenPort === undefined) fail('MCP_CONNECTION_UNAVAILABLE', '服务连接不可用。');
      const authority = tokenPort.authority(server.connectionId, server.endpoint);
      const owner = this.identity();
      if (authority.ownerId !== owner.ownerId || authority.identityEpoch !== owner.epoch)
        fail('MCP_IDENTITY_REQUIRED', '服务连接身份不匹配。');
      const token = await tokenPort.read(server.connectionId, server.endpoint, signal);
      headers['Authorization'] = `Bearer ${token}`;
      secrets.push(token);
    }
    if (server.oauth) {
      const token = await this.oauth.accessToken(server, signal);
      headers['Authorization'] = `Bearer ${token}`;
      secrets.push(token);
    }
    this.assertAuthority(this.require(server.id));
    return {
      serverId: server.id,
      endpoint: server.endpoint,
      transport: server.transport,
      headers,
      secrets,
      authorizationKey: hash([server.revision, server.accessEpoch, server.grant?.id]),
    };
  }
  /** A one-off protocol probe never publishes configuration, trust or a selectable catalog. */
  public async testDraft(
    input: RemoteMcpDraftTestInput,
    signal: AbortSignal,
  ): Promise<RemoteMcpDraftTestResult> {
    if (this.closed) fail('MCP_CLOSED', 'MCP服务正在关闭。');
    this.identity();
    const task = testRemoteMcpDraft(this.manager, input, signal, this.options.fixtureOrigin);
    this.pending.add(task);
    try {
      const result = await task;
      if (this.closed) fail('MCP_CLOSED', 'MCP服务正在关闭。');
      return result;
    } finally {
      this.pending.delete(task);
    }
  }
  public async discover(
    id: string,
    input: McpControlInput,
    signal: AbortSignal,
  ): Promise<McpToolCatalog> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const binding = await this.binding(server, signal);
    const value = await this.manager.discover(binding, { signal });
    this.expected(this.require(id), server.revision, server.accessEpoch);
    this.assertAuthority(this.require(id));
    const entry = {
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      value,
      discoveredAt: Date.now(),
    };
    this.catalogs.set(id, entry);
    return this.catalogView(server, entry);
  }
  private catalogView(server: StoredRemoteMcpServer, entry: CatalogEntry): McpToolCatalog {
    return {
      serverId: server.id,
      serverRevision: server.revision,
      scope: 'sandboxed',
      discoveredAt: entry.discoveredAt,
      tools: entry.value.tools.map((tool) => ({
        serverId: server.id,
        serverRevision: server.revision,
        remoteToolName: tool.remoteToolName,
        name: alias(server.id, tool.remoteToolName),
        description: tool.description.slice(0, 16000),
        definitionFingerprint: tool.definitionFingerprint,
        available:
          tool.supported &&
          this.options.store.mcp.directory.control(server.id, tool.remoteToolName).enabled,
        enabled: this.options.store.mcp.directory.control(server.id, tool.remoteToolName).enabled,
        readOnlyAuthorized: this.options.store.mcp.directory
          .grants(server.id)
          .some(
            (grant) =>
              grant.remoteToolName === tool.remoteToolName &&
              grant.definitionFingerprint === tool.definitionFingerprint &&
              grant.serverRevision === server.revision &&
              grant.accessEpoch === server.accessEpoch,
          ),
        diagnostic: tool.unavailableReason,
      })),
    };
  }
  public catalog(id: string, _scope: McpScope = 'sandboxed'): McpToolCatalog | null {
    const server = this.require(id);
    const entry = this.catalogs.get(id);
    if (
      entry === undefined ||
      !server.enabled ||
      !this.pluginAvailable(server) ||
      entry.revision !== server.revision ||
      entry.accessEpoch !== server.accessEpoch
    )
      return null;
    return this.catalogView(server, entry);
  }
  public metadata(id: string): McpMetadata | null {
    if (this.catalog(id) === null) return null;
    const entry = this.catalogs.get(id);
    if (entry === undefined) return null;
    return mcpMetadata(entry.value);
  }
  public freezeSelections(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    workMode: 'execute' | 'plan',
    selections: readonly McpToolSelection[],
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]> {
    if (selections.length > 16) fail('MCP_SELECTION_INVALID', '一次最多选择16个工具。');
    const result: FrozenMcpTool[] = [];
    const selected = new Set<string>();
    const identity = this.identity();
    for (const selection of selections) {
      const key = JSON.stringify([selection.serverId, selection.remoteToolName]);
      if (selected.has(key)) fail('MCP_SELECTION_INVALID', '外部工具选择重复。');
      selected.add(key);
      signal.throwIfAborted();
      const server = this.require(selection.serverId);
      this.expected(server, selection.serverRevision);
      this.assertAuthority(server);
      const catalog = this.catalogs.get(server.id);
      const tool = catalog?.value.tools.find(
        (entry) =>
          entry.remoteToolName === selection.remoteToolName &&
          entry.definitionFingerprint === selection.definitionFingerprint,
      );
      const control = this.options.store.mcp.directory.control(server.id, selection.remoteToolName);
      if (
        tool === undefined ||
        tool.parameters === null ||
        !tool.supported ||
        !control.enabled ||
        catalog?.revision !== server.revision ||
        catalog.accessEpoch !== server.accessEpoch
      )
        fail('MCP_SELECTION_STALE', '工具目录已失效，请重新发现。');
      const grant = this.options.store.mcp.directory
        .grants(server.id)
        .find(
          (entry) =>
            entry.remoteToolName === selection.remoteToolName &&
            entry.definitionFingerprint === selection.definitionFingerprint &&
            entry.serverRevision === server.revision &&
            entry.accessEpoch === server.accessEpoch &&
            entry.ownerId === identity.ownerId &&
            entry.identityEpoch === identity.epoch &&
            entry.toolControlRevision === control.revision,
        );
      if ((approvalMode === 'read-only' || workMode === 'plan') && grant === undefined)
        fail('MCP_SELECTION_FORBIDDEN', '此工具没有精确只读授权。');
      if (server.grant === null) fail('MCP_DISABLED', '远端授权失效。');
      result.push({
        selection: { ...selection },
        definition: {
          name: alias(server.id, tool.remoteToolName),
          description: tool.description,
          parameters: tool.parameters,
        },
        authorization: {
          ownerId: identity.ownerId,
          identityEpoch: identity.epoch,
          accessEpoch: server.accessEpoch,
          credentialEpoch: server.secretBindings.reduce((sum, slot) => sum + slot.epoch, 1),
          grantId: server.grant.id,
          workspaceId: workspaceId ?? '',
          workspaceRoot: new URL(server.endpoint).origin,
          ...(server.connectionId === undefined
            ? {}
            : {
                connectionId: server.connectionId,
                connectionAccessEpoch: this.connectionAuthority(server).accessEpoch,
              }),
          scope: approvalMode === 'full-access' ? 'full-access' : 'sandboxed',
          startupFingerprint: server.grant.fingerprint,
          toolControlRevision: control.revision,
          ...(grant === undefined ? {} : { readOnlyGrantId: grant.id }),
        },
      });
    }
    return Promise.resolve(result);
  }
  public async freezeCandidates(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    workMode: 'execute' | 'plan',
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]> {
    const result: FrozenMcpTool[] = [];
    for (const server of this.list()) {
      if (!server.enabled || !server.trusted) continue;
      const catalog = this.catalog(server.id);
      if (catalog === null) continue;
      const tools = catalog.tools.filter(
        (tool) =>
          tool.available &&
          (!(approvalMode === 'read-only' || workMode === 'plan') ||
            this.options.store.mcp.directory
              .grants(server.id)
              .some(
                (grant) =>
                  grant.remoteToolName === tool.remoteToolName &&
                  grant.definitionFingerprint === tool.definitionFingerprint,
              )),
      );
      if (result.length + tools.length > 512) fail('MCP_CATALOG_LIMIT', '远程工具目录超过512项。');
      for (let offset = 0; offset < tools.length; offset += 16)
        result.push(
          ...(await this.freezeSelections(
            workspaceId,
            approvalMode,
            workMode,
            tools.slice(offset, offset + 16).map((tool) => ({
              serverId: tool.serverId,
              serverRevision: tool.serverRevision,
              remoteToolName: tool.remoteToolName,
              definitionFingerprint: tool.definitionFingerprint,
            })),
            signal,
          )),
        );
    }
    return result;
  }
  public assertBindingsCurrent(tools: readonly FrozenMcpTool[]): void {
    for (const frozen of tools) {
      const server = this.require(frozen.selection.serverId);
      this.expected(server, frozen.selection.serverRevision, frozen.authorization.accessEpoch);
      this.assertAuthority(server);
      const identity = this.identity();
      if (server.connectionId !== undefined) {
        const authority = this.connectionAuthority(server);
        if (
          authority.connectionId !== frozen.authorization.connectionId ||
          authority.accessEpoch !== frozen.authorization.connectionAccessEpoch
        )
          fail('MCP_SELECTION_STALE', '外部服务连接授权已变化。');
      }
      const control = this.options.store.mcp.directory.control(
        server.id,
        frozen.selection.remoteToolName,
      );
      if (
        frozen.definition.name !== alias(server.id, frozen.selection.remoteToolName) ||
        server.grant?.id !== frozen.authorization.grantId ||
        identity.ownerId !== frozen.authorization.ownerId ||
        identity.epoch !== frozen.authorization.identityEpoch ||
        !control.enabled ||
        control.revision !== frozen.authorization.toolControlRevision ||
        server.secretBindings.reduce((sum, slot) => sum + slot.epoch, 1) !==
          frozen.authorization.credentialEpoch ||
        server.grant.fingerprint !== frozen.authorization.startupFingerprint
      )
        fail('MCP_SELECTION_STALE', '原工具授权已失效，请重新选择。');
      if (
        frozen.authorization.readOnlyGrantId !== undefined &&
        !this.options.store.mcp.directory
          .grants(server.id)
          .some((grant) => grant.id === frozen.authorization.readOnlyGrantId)
      )
        fail('MCP_SELECTION_STALE', '只读授权已撤销。');
    }
  }
  public validateBindings(tools: readonly FrozenMcpTool[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.assertBindingsCurrent(tools);
    return Promise.resolve();
  }
  public async restoreBindings(
    tools: readonly FrozenMcpTool[],
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]> {
    await this.validateBindings(tools, signal);
    return tools.map((tool) => ({
      ...tool,
      definition: {
        ...tool.definition,
        parameters: compileMcpInputSchema(tool.definition.parameters),
      },
    }));
  }
  public isReadOnlyAuthorized(tool: FrozenMcpTool, args: Record<string, unknown>): boolean {
    return this.directory.authorized(tool, args);
  }
  public async call(input: ExternalToolCall): Promise<ExternalToolOutcome> {
    this.assertBindingsCurrent([input.tool]);
    const server = this.require(input.tool.selection.serverId);
    const binding = await this.binding(server, input.signal);
    const lease = await this.manager.acquire(binding, { signal: input.signal });
    try {
      this.assertBindingsCurrent([input.tool]);
      const tool = lease.catalog.tools.find(
        (candidate) =>
          candidate.remoteToolName === input.tool.selection.remoteToolName &&
          candidate.definitionFingerprint === input.tool.selection.definitionFingerprint,
      );
      if (tool === undefined)
        return {
          kind: 'not-dispatched',
          cancelled: false,
          message: '远端工具定义已变化，请重新发现。',
        };
      return await lease.call({
        tool,
        arguments: input.arguments,
        callAttemptId: input.callAttemptId,
        signal: input.signal,
        beforeDispatch: async () => {
          this.assertBindingsCurrent([input.tool]);
          await input.beforeDispatch();
          this.assertBindingsCurrent([input.tool]);
        },
      });
    } finally {
      await lease.release();
    }
  }
  public async setToolControl(id: string, input: McpToolControlInput): Promise<McpToolControl> {
    return await this.directory.setControl(id, input);
  }
  public grantReadOnly(id: string, input: McpReadOnlyGrantInput): { id: string } {
    return this.directory.grant(id, input);
  }
  public readOnlyGrants(id: string): McpReadOnlyGrantView[] {
    return this.directory.list(id);
  }
  public async revokeReadOnly(id: string, grantId: string): Promise<void> {
    await this.directory.revoke(id, grantId);
  }
  private connectionAuthority(server: StoredRemoteMcpServer) {
    if (server.connectionId === undefined || this.options.connectionToken === undefined)
      fail('MCP_CONNECTION_UNAVAILABLE', '服务连接不可用。');
    const authority = this.options.connectionToken.authority(server.connectionId, server.endpoint);
    const identity = this.identity();
    if (authority.ownerId !== identity.ownerId || authority.identityEpoch !== identity.epoch)
      fail('MCP_IDENTITY_REQUIRED', '服务连接身份不匹配。');
    return authority;
  }
  public async invalidateConnection(connectionId: string): Promise<void> {
    await Promise.all(
      this.options.repository
        .list()
        .filter((server) => server.connectionId === connectionId)
        .map((server) => this.manager.invalidateServer(server.id)),
    );
  }
  public async writeOAuthClientSecret(id: string, input: McpSecretInput): Promise<RemoteMcpView> {
    return await this.mutate(id, async () => {
      const server = this.require(id);
      this.expected(server, input.expectedRevision);
      if (server.oauthClient?.clientSecret !== true)
        fail('MCP_OAUTH_DISABLED', '此服务器没有配置预注册客户端秘密。');
      const ref = `mcp-oauth-client:${id}:${randomUUID()}`;
      let saved: StoredRemoteMcpServer;
      try {
        await this.options.credentials.write(ref, input.value);
        this.expected(this.require(id), server.revision, server.accessEpoch);
        saved = this.options.repository.save(
          {
            ...server,
            revision: server.revision + 1,
            accessEpoch: server.accessEpoch + 1,
            enabled: false,
            grant: null,
            oauthClientSecretRef: ref,
            oauthCredentialRef: null,
            oauthConnected: false,
            updatedAt: Date.now(),
          },
          server.revision,
          server.accessEpoch,
        );
      } catch (error) {
        await this.options.credentials.delete(ref);
        if (error instanceof RuntimeError) throw error;
        fail('MCP_CREDENTIAL_WRITE_FAILED', '系统凭据保存失败，配置未生效。');
      }
      this.catalogs.delete(id);
      this.cancelFlows(id);
      for (const previous of [server.oauthClientSecretRef, server.oauthCredentialRef])
        if (previous !== null) await this.options.credentials.delete(previous);
      return this.view(saved);
    });
  }
  public stopAccepting(): void {
    this.closed = true;
    this.oauth.stopAccepting();
  }
  public async close(): Promise<void> {
    this.stopAccepting();
    await this.manager.close();
    await this.oauth.close();
    await Promise.allSettled([...this.pending]);
  }
}
