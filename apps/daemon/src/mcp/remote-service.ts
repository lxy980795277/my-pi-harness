import { randomUUID } from 'node:crypto';
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
} from '@my-pi-harness/integrations';
import type {
  ToolDiscoveryDiagnostic,
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
import type { StoredRemoteMcpServer } from '@my-pi-harness/storage';

import type { RemoteMcpServiceOptions } from './remote-options.js';
import { closeMcpResources } from './lifecycle.js';
import { RemoteCatalogs, type RemoteCatalogEntry as CatalogEntry } from './remote-catalogs.js';
import {
  remoteStartupFingerprint,
  remoteFingerprint as hash,
  remoteToolAlias as alias,
} from './remote-fingerprint.js';
import { RemoteMcpOAuth } from './remote-oauth.js';
import { remoteMcpView } from './remote-view.js';
import { McpDirectoryPolicy, mcpMetadata } from './directory.js';
import { assertRemoteNameAvailable, validateRemoteInput } from './remote-configuration.js';
import { testRemoteMcpDraft } from './remote-connection-test.js';
import {
  connectionAuthority,
  pluginCredentialId,
  pluginAppAvailable,
  pluginStartupGrant,
  serviceToken,
  readMcpHeaders,
} from './plugin-credentials.js';
function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}
/** Profile-scoped remote authority is independent from application login cookies and local workspaces. */
export class RemoteMcpService implements ExternalTools {
  private readonly manager: RemoteMcpManager;
  private readonly directory: McpDirectoryPolicy;
  private readonly catalogs: RemoteCatalogs;
  private readonly oauth: RemoteMcpOAuth;
  private readonly mutations = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | undefined;
  public constructor(private readonly options: RemoteMcpServiceOptions) {
    this.catalogs = new RemoteCatalogs(
      options.store.mcp.directory,
      {
        require: (id) => this.require(id),
        identity: () => this.identity(),
        available: (server) => this.pluginAvailable(server),
        assertAuthority: (server) => this.assertAuthority(server),
        connectionAuthority: (server) => this.connectionAuthority(server),
        discover: (id, input, signal) => this.discover(id, input, signal),
      },
      (serverId) => options.onBackgroundError?.({ code: 'MCP_APP_DISCOVERY_FAILED', serverId }),
    );
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
      catalogChanged: (id) => {
        this.catalogs.delete(id);
        this.catalogs.startServer(id);
      },
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
    return remoteStartupFingerprint(server);
  }
  private view(server: StoredRemoteMcpServer): RemoteMcpView {
    return remoteMcpView(
      server,
      this.pluginAvailable(server),
      this.catalogs.currentState(server.id),
    );
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
    return pluginAppAvailable(server, this.options.store.extensions.plugins());
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
    this.catalogs.delete(id);
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
    this.catalogs.delete(id);
    await this.mutate(id, async () => {
      const server = this.require(id);
      this.expected(server, expectedRevision);
      this.options.repository.remove(id, expectedRevision);
      this.options.store.mcp.directory.remove(id);
      this.oauth.cancel(id);
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
  public async cancelOAuth(id: string, input: McpControlInput): Promise<RemoteMcpView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    this.identity();
    await this.oauth.cancelAuthorization(id);
    const current = this.require(id);
    this.expected(current, input.expectedRevision, input.expectedAccessEpoch);
    return this.view(current);
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
    const { headers, secrets } = await readMcpHeaders(server, this.options.credentials);
    const sharedToken = await serviceToken(
      server,
      this.identity(),
      this.options.pluginToken,
      this.options.connectionToken,
      signal,
    );
    if (sharedToken !== undefined) {
      headers['Authorization'] = `Bearer ${sharedToken}`;
      secrets.push(sharedToken);
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
      authorizationKey: hash([
        server.revision,
        server.accessEpoch,
        server.grant?.id,
        ...secrets.map((value) => hash(value)),
      ]),
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
    signal.throwIfAborted();
    this.expected(this.require(id), server.revision, server.accessEpoch);
    this.assertAuthority(this.require(id));
    const entry = {
      authority: this.catalogs.authority(this.require(id)),
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      value,
      discoveredAt: Date.now(),
    };
    this.catalogs.publish(id, id, 'remote', entry);
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
    let authority: string;
    try {
      authority = this.catalogs.authority(server);
    } catch {
      return null;
    }
    if (
      entry === undefined ||
      entry.authority !== authority ||
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
      if (approvalMode === 'read-only' && grant === undefined)
        fail('MCP_SELECTION_FORBIDDEN', '此工具没有精确只读授权。');
      if (server.grant === null) fail('MCP_DISABLED', '远端授权失效。');
      result.push({
        selection: { ...selection },
        displayName: `${server.name} / ${tool.remoteToolName}`,
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
          ...(server.connectionId === undefined && pluginCredentialId(server) === undefined
            ? {}
            : {
                connectionId: this.connectionAuthority(server).connectionId,
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
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]> {
    await Promise.all(
      this.list()
        .filter((server) => server.enabled && server.trusted)
        .map((server) => this.catalogs.prepareServer(server.id, signal)),
    );
    const result: FrozenMcpTool[] = [];
    for (const server of this.list()) {
      if (!server.enabled || !server.trusted) continue;
      const catalog = this.catalog(server.id);
      if (catalog === null) continue;
      const tools = catalog.tools.filter(
        (tool) =>
          tool.available &&
          (!(approvalMode === 'read-only') ||
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
      if (server.connectionId !== undefined || pluginCredentialId(server) !== undefined) {
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
    return connectionAuthority(
      server,
      this.identity(),
      this.options.pluginToken,
      this.options.connectionToken,
    );
  }
  /** The explicit App switch grants startup trust only to its installed, owned configuration. */
  public enablePluginApp(id: string, pluginId: string, componentId: string): void {
    const server = this.require(id);
    if (!this.ownedBy(id, pluginId, componentId)) fail('MCP_PLUGIN_OWNER', '插件应用归属不匹配。');
    const grant = pluginStartupGrant(
      server,
      pluginId,
      componentId,
      this.identity(),
      this.fingerprint(server),
    );
    this.options.repository.save(
      { ...server, enabled: true, grant, updatedAt: Date.now() },
      server.revision,
      server.accessEpoch,
    );
  }
  /** Startup preparation is background-owned; GET requests only inspect its safe state. */
  public initializeCatalogs(): void {
    for (const server of this.list())
      if (server.enabled && server.trusted) this.catalogs.startServer(server.id);
  }
  /** Explicit switches enqueue discovery; a Run joins the same owned task when it needs candidates. */
  public schedulePluginApp(id: string): void {
    this.catalogs.startServer(id);
  }
  public diagnostics(): readonly ToolDiscoveryDiagnostic[] {
    return this.catalogs.diagnostics(this.list());
  }
  public async invalidatePlugin(pluginId: string): Promise<void> {
    await Promise.all(
      this.options.repository
        .list()
        .filter((server) => server.pluginOwner?.pluginId === pluginId)
        .map(async (server) => {
          this.catalogs.delete(server.id);
          await this.manager.invalidateServer(server.id);
          this.catalogs.startServer(server.id);
        }),
    );
  }
  public async invalidateConnection(connectionId: string): Promise<void> {
    const servers = this.options.repository
      .list()
      .filter((server) => server.connectionId === connectionId);
    await Promise.all(
      servers.map(async (server) => {
        this.catalogs.delete(server.id);
        await this.manager.invalidateServer(server.id);
        this.catalogs.startServer(server.id);
      }),
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
      this.cancelFlows(id);
      for (const previous of [server.oauthClientSecretRef, server.oauthCredentialRef])
        if (previous !== null) await this.options.credentials.delete(previous);
      return this.view(saved);
    });
  }
  public stopAccepting(): void {
    this.closed = true;
    this.oauth.stopAccepting();
    this.catalogs.stop();
  }
  public close(): Promise<void> {
    this.stopAccepting();
    this.closing ??= closeMcpResources([
      this.manager.close(),
      this.oauth.close(),
      this.catalogs.close(),
      ...this.pending,
    ]);
    return this.closing;
  }
}
