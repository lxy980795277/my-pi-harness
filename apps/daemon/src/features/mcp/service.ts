import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  RuntimeError,
  type ExternalTools,
  type ExternalToolCall,
  type ExternalToolOutcome,
  type FrozenMcpTool,
} from '@my-pi-harness/agent-runtime';
import {
  McpConnectionManager,
  compileMcpInputSchema,
  type McpCatalog,
  type McpConnectionBinding,
  type McpLaunchInput,
} from '@my-pi-harness/integrations';
import type {
  ApprovalMode,
  McpControlInput,
  McpMetadata,
  McpToolControl,
  McpReadOnlyGrantView,
  McpToolControlInput,
  McpReadOnlyGrantInput,
  McpScope,
  McpScopeInput,
  McpSecretInput,
  McpServerInput,
  McpServerUpdate,
  McpServerView,
  McpToolCatalog,
  McpToolSelection,
  McpTrustInput,
  McpTrustPreview,
  Workspace,
} from '@my-pi-harness/protocol';
import {
  StorageError,
  type CredentialStore,
  type ProfileStore,
  type StoredMcpServer,
  type McpStartupGrant,
} from '@my-pi-harness/storage';
import type { McpManager } from './types.js';
import { McpDirectoryPolicy, mcpMetadata } from './directory.js';

const forbiddenEnvironment = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_OPTIONS',
  'NODE_PATH',
  'BASH_ENV',
  'ENV',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'SHELL',
  'ZDOTDIR',
  'PYTHONPATH',
  'PYTHONHOME',
  'RUBYOPT',
  'PERL5OPT',
]);
const MAX_ENVIRONMENT_VARIABLES = 64;

interface CatalogEntry {
  revision: number;
  accessEpoch: number;
  startupFingerprint: string;
  value: McpCatalog;
  discoveredAt: number;
}

export interface McpServiceOptions {
  store: ProfileStore;
  credentials: CredentialStore;
  profileDirectory: string;
  resolveWorkspace: (id: string) => Promise<Workspace>;
  manager?: McpManager;
}

function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}

/** Stable aliases route through frozen bindings; display names are never parsed as identities. */
function modelName(serverId: string, remoteToolName: string): string {
  return `mcp_${createHash('sha256').update(serverId).digest('hex').slice(0, 16)}_${createHash('sha256').update(remoteToolName).digest('hex').slice(0, 32)}`;
}

function credentialEpoch(server: StoredMcpServer): number {
  return server.secretBindings.reduce((total, binding) => total + binding.credentialEpoch, 1);
}

/** Owns MCP configuration, OS secret references and explicit startup authorizations. */
export class McpService implements ExternalTools {
  private readonly manager: McpManager;
  private readonly directory: McpDirectoryPolicy;
  private readonly catalogs = new Map<string, CatalogEntry>();
  private readonly diagnostics = new Map<string, string>();
  private readonly mutations = new Set<string>();
  private readonly pendingMutations = new Set<Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | undefined;

  public constructor(private readonly options: McpServiceOptions) {
    this.manager = options.manager ?? new McpConnectionManager();
    this.directory = new McpDirectoryPolicy(options.store, {
      server: (id) => this.require(id),
      identity: () => this.identity(),
      catalogs: (id) =>
        [this.catalogs.get(`${id}:sandboxed`), this.catalogs.get(`${id}:full-access`)].flatMap(
          (entry) => (entry === undefined ? [] : [entry.value]),
        ),
      invalidate: (id) => this.manager.invalidateServer(id),
      assert: (tools) => this.assertBindingsCurrent(tools),
    });
  }

  private assertOpen(): void {
    if (this.closed) fail('MCP_CLOSED', 'MCP服务正在关闭。');
  }
  private require(id: string): StoredMcpServer {
    this.assertOpen();
    const value = this.options.store.mcp.get(id);
    if (value === undefined) fail('MCP_SERVER_NOT_FOUND', 'MCP服务器不存在。');
    return value;
  }
  private identity() {
    const owner = this.options.store.auth.profileOwner();
    if (owner === undefined) fail('MCP_IDENTITY_REQUIRED', '请先登录后管理MCP服务器。');
    return this.options.store.mcp.identity(owner.id);
  }
  private expected(server: StoredMcpServer, revision: number, accessEpoch?: number): void {
    if (
      server.revision !== revision ||
      (accessEpoch !== undefined && server.accessEpoch !== accessEpoch)
    )
      fail('MCP_CONFLICT', 'MCP配置或授权已变化，请刷新后重试。');
  }
  private idle(id: string): void {
    this.assertOpen();
    if (this.mutations.has(id) || this.manager.hasActiveLeases(id))
      fail('MCP_BUSY', 'MCP服务器正在使用，暂时不能修改配置。');
  }
  private mutation<T>(id: string, operation: () => Promise<T>): Promise<T> {
    this.idle(id);
    this.mutations.add(id);
    const task = operation().finally(() => {
      this.mutations.delete(id);
      this.pendingMutations.delete(task);
    });
    this.pendingMutations.add(task);
    return task;
  }
  private validateInput(input: McpServerInput): McpServerInput {
    if (!isAbsolute(input.command) || input.command.includes('\0'))
      fail('MCP_COMMAND_INVALID', '请选择可检查的绝对程序路径。');
    const name = input.name.trim();
    if (!name) fail('MCP_NAME_INVALID', 'MCP服务器名称不能为空。');
    const names = new Set(Object.keys(input.publicEnvironment));
    if (names.size + input.secretSlots.length > MAX_ENVIRONMENT_VARIABLES)
      fail('MCP_ENVIRONMENT_INVALID', '环境变量数量超过限制。');
    const slots = new Set<string>();
    for (const slot of input.secretSlots) {
      if (slots.has(slot.slotId) || names.has(slot.environmentName))
        fail('MCP_ENVIRONMENT_INVALID', '秘密槽位或环境变量名称重复。');
      slots.add(slot.slotId);
      names.add(slot.environmentName);
    }
    for (const key of names) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        forbiddenEnvironment.has(key.toUpperCase()) ||
        key.startsWith('DYLD_') ||
        key.startsWith('LD_')
      )
        fail('MCP_ENVIRONMENT_INVALID', '配置不能覆盖宿主的启动控制环境变量。');
    }
    for (const value of [...input.args, ...Object.values(input.publicEnvironment)]) {
      if (value.includes('\0')) fail('MCP_ENVIRONMENT_INVALID', '配置不能包含空字符。');
    }
    return { ...input, name };
  }
  private view(server: StoredMcpServer): McpServerView {
    const owner = this.options.store.auth.profileOwner();
    const grants = this.options.store.mcp.grants(server.id);
    return {
      id: server.id,
      name: server.name,
      transport: 'stdio',
      revision: server.revision,
      workspaceId: server.workspaceId,
      command: server.command,
      args: server.args,
      publicEnvironment: server.publicEnvironment,
      secretSlots: server.secretBindings.map((binding) => ({
        slotId: binding.slotId,
        environmentName: binding.environmentName,
        configured: binding.credentialRef !== null,
      })),
      enabled: server.enabled,
      accessEpoch: server.accessEpoch,
      trustedScopes: grants
        .filter(
          (grant) =>
            grant.serverRevision === server.revision &&
            grant.accessEpoch === server.accessEpoch &&
            grant.ownerId === owner?.id,
        )
        .map((grant) => grant.scope),
      connectionState: this.manager.hasActiveLeases(server.id) ? 'connected' : 'disconnected',
      diagnostic: this.diagnostics.get(server.id) ?? null,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }
  public list(): McpServerView[] {
    this.assertOpen();
    return this.options.store.mcp.list().map((server) => this.view(server));
  }
  public get(id: string): McpServerView {
    return this.view(this.require(id));
  }

  public async prepareInput(input: McpServerInput): Promise<McpServerInput> {
    this.identity();
    const configuration = this.validateInput(input);
    await this.options.resolveWorkspace(configuration.workspaceId);
    this.assertOpen();
    return configuration;
  }
  public async create(input: McpServerInput): Promise<McpServerView> {
    this.assertOpen();
    this.identity();
    const configuration = this.validateInput(input);
    await this.options.resolveWorkspace(configuration.workspaceId);
    this.assertOpen();
    const at = Date.now();
    return this.view(
      this.options.store.mcp.save(
        {
          ...configuration,
          id: randomUUID(),
          revision: 1,
          enabled: false,
          accessEpoch: 1,
          secretBindings: configuration.secretSlots.map((slot) => ({
            ...slot,
            credentialRef: null,
            credentialEpoch: 1,
          })),
          createdAt: at,
          updatedAt: at,
        },
        null,
      ),
    );
  }
  public async update(id: string, input: McpServerUpdate): Promise<McpServerView> {
    return this.mutation(id, async () => {
      const server = this.require(id);
      this.expected(server, input.expectedRevision);
      const { expectedRevision: _expected, ...configuration } = input;
      const next = this.validateInput(configuration);
      await this.options.resolveWorkspace(next.workspaceId);
      this.expected(this.require(id), server.revision, server.accessEpoch);
      const bindings = next.secretSlots.map((slot) => {
        const previous = server.secretBindings.find(
          (binding) =>
            binding.slotId === slot.slotId && binding.environmentName === slot.environmentName,
        );
        return previous ?? { ...slot, credentialRef: null, credentialEpoch: 1 };
      });
      const saved = this.options.store.mcp.save(
        {
          ...server,
          ...next,
          revision: server.revision + 1,
          enabled: false,
          secretBindings: bindings,
          updatedAt: Date.now(),
        },
        server.revision,
        server.accessEpoch,
      );
      this.clearCatalog(id);
      await this.deleteRefs(
        server.secretBindings
          .filter(
            (binding) => !bindings.some((next) => next.credentialRef === binding.credentialRef),
          )
          .map((binding) => binding.credentialRef),
      );
      return this.view(saved);
    });
  }
  public async remove(id: string, expectedRevision: number): Promise<void> {
    await this.mutation(id, async () => {
      const server = this.require(id);
      this.expected(server, expectedRevision);
      this.options.store.mcp.remove(id, expectedRevision);
      this.clearCatalog(id);
      await this.deleteRefs(server.secretBindings.map((binding) => binding.credentialRef));
    });
  }
  private async deleteRefs(refs: readonly (string | null)[]): Promise<void> {
    const results = await Promise.allSettled(
      refs
        .filter((ref): ref is string => ref !== null)
        .map((ref) => this.options.credentials.delete(ref)),
    );
    if (results.some((result) => result.status === 'rejected'))
      fail('MCP_CREDENTIAL_CLEANUP_FAILED', '配置已保存，但旧系统凭据清理失败。');
  }
  public async writeSecret(
    id: string,
    slotId: string,
    input: McpSecretInput,
  ): Promise<McpServerView> {
    return this.mutation(id, async () => {
      const server = this.require(id);
      this.expected(server, input.expectedRevision);
      const slot = server.secretBindings.find((binding) => binding.slotId === slotId);
      if (slot === undefined) fail('MCP_SECRET_NOT_FOUND', '秘密槽位不存在。');
      const ref = `mcp:${id}:${slotId}:${randomUUID()}`;
      let saved: StoredMcpServer;
      try {
        await this.options.credentials.write(ref, input.value);
        this.expected(this.require(id), server.revision, server.accessEpoch);
        saved = this.options.store.mcp.save(
          {
            ...server,
            revision: server.revision + 1,
            enabled: false,
            updatedAt: Date.now(),
            secretBindings: server.secretBindings.map((binding) =>
              binding.slotId === slotId
                ? { ...binding, credentialRef: ref, credentialEpoch: binding.credentialEpoch + 1 }
                : binding,
            ),
          },
          server.revision,
          server.accessEpoch,
        );
      } catch (cause) {
        try {
          await this.options.credentials.delete(ref);
        } catch {
          fail(
            'MCP_CREDENTIAL_ROLLBACK_FAILED',
            '秘密未生效，系统凭据回滚失败，请检查本机凭据库。',
          );
        }
        if (cause instanceof RuntimeError || cause instanceof StorageError) throw cause;
        fail('MCP_CREDENTIAL_WRITE_FAILED', '系统凭据未保存，配置保持原状。');
      }
      this.clearCatalog(id);
      await this.deleteRefs([slot.credentialRef]);
      return this.view(saved);
    });
  }

  /** Explicit credential deletion takes effect before connection teardown completes. */
  public async deleteSecret(
    id: string,
    slotId: string,
    input: McpControlInput,
  ): Promise<McpServerView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const slot = server.secretBindings.find((binding) => binding.slotId === slotId);
    if (slot === undefined) fail('MCP_SECRET_NOT_FOUND', '秘密槽位不存在。');
    const next = {
      ...server,
      revision: server.revision + 1,
      accessEpoch: server.accessEpoch + 1,
      enabled: false,
      secretBindings: server.secretBindings.map((binding) =>
        binding.slotId === slotId
          ? { ...binding, credentialRef: null, credentialEpoch: binding.credentialEpoch + 1 }
          : binding,
      ),
      updatedAt: Date.now(),
    };
    const revoked = this.options.store.mcp.save(next, server.revision, server.accessEpoch);
    this.clearCatalog(id);
    await this.manager.invalidateServer(id);
    await this.deleteRefs([slot.credentialRef]);
    return this.view(revoked);
  }
  private clearCatalog(id: string): void {
    this.catalogs.delete(`${id}:sandboxed`);
    this.catalogs.delete(`${id}:full-access`);
    this.diagnostics.delete(id);
  }

  private async launch(
    server: StoredMcpServer,
    scope: McpScope,
    readSecrets: boolean,
  ): Promise<McpLaunchInput> {
    const workspace = await this.options.resolveWorkspace(server.workspaceId);
    const environment: Record<string, string> = { ...server.publicEnvironment };
    const descriptors = [];
    for (const binding of server.secretBindings) {
      if (binding.credentialRef === null) fail('MCP_CREDENTIAL_REQUIRED', '请先配置所有秘密槽位。');
      descriptors.push({ ...binding, credentialRef: binding.credentialRef });
      if (readSecrets) {
        const secret = await this.options.credentials.read(binding.credentialRef);
        if (secret === undefined) fail('MCP_CREDENTIAL_REQUIRED', '系统凭据不存在，请重新配置。');
        environment[binding.environmentName] = secret;
      }
    }
    return {
      command: server.command,
      args: server.args,
      workspaceRoot: workspace.rootPath,
      profileDirectory: this.options.profileDirectory,
      environment,
      secretDescriptors: descriptors,
      scope,
    };
  }
  private async previewLaunch(launch: McpLaunchInput) {
    try {
      return await this.manager.previewLaunch(launch);
    } catch {
      fail('MCP_STARTUP_INVALID', '无法解析启动程序或隔离范围，请检查绝对程序路径与工作区。');
    }
  }
  public async preview(id: string, input: McpScopeInput): Promise<McpTrustPreview> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    this.identity();
    const launch = await this.launch(server, input.scope, false);
    const preview = await this.previewLaunch(launch);
    this.expected(this.require(id), server.revision, server.accessEpoch);
    return {
      serverId: id,
      revision: server.revision,
      accessEpoch: server.accessEpoch,
      scope: input.scope,
      command: preview.launch.command,
      args: [...preview.launch.args],
      workspaceRoot: launch.workspaceRoot,
      environmentNames: [
        ...Object.keys(server.publicEnvironment),
        ...server.secretBindings.map((slot) => slot.environmentName),
      ].sort(),
      networkPolicy: input.scope === 'sandboxed' ? 'blocked' : 'unrestricted',
      startupFingerprint: preview.startupFingerprint,
    };
  }
  public async trust(id: string, input: McpTrustInput): Promise<McpServerView> {
    const identity = this.identity();
    const preview = await this.preview(id, input);
    if (preview.startupFingerprint !== input.startupFingerprint)
      fail('MCP_CONFLICT', '启动配置已变化，请重新确认。');
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const currentIdentity = this.identity();
    if (currentIdentity.ownerId !== identity.ownerId || currentIdentity.epoch !== identity.epoch)
      fail('MCP_CONFLICT', '启动确认期间身份授权已变化，请重新确认。');
    const current = this.options.store.mcp.grant(id, input.scope);
    const sameGrant =
      current !== undefined &&
      current.serverRevision === server.revision &&
      current.accessEpoch === server.accessEpoch &&
      current.ownerId === identity.ownerId &&
      current.identityEpoch === identity.epoch &&
      current.workspaceRoot === preview.workspaceRoot &&
      current.startupFingerprint === preview.startupFingerprint;
    const grant: McpStartupGrant = {
      id: sameGrant ? current.id : randomUUID(),
      serverId: id,
      serverRevision: server.revision,
      accessEpoch: server.accessEpoch,
      scope: input.scope,
      ownerId: identity.ownerId,
      identityEpoch: identity.epoch,
      workspaceId: server.workspaceId,
      workspaceRoot: preview.workspaceRoot,
      startupFingerprint: preview.startupFingerprint,
      grantedAt: Date.now(),
    };
    return this.view(this.options.store.mcp.trust(grant));
  }
  public async disable(id: string, input: McpControlInput): Promise<McpServerView> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const saved = this.options.store.mcp.save(
      { ...server, enabled: false, accessEpoch: server.accessEpoch + 1, updatedAt: Date.now() },
      server.revision,
      server.accessEpoch,
    );
    this.clearCatalog(id);
    await this.manager.invalidateServer(id);
    return this.view(saved);
  }
  public async revokeIdentity(): Promise<void> {
    const identity = this.identity();
    this.options.store.mcp.revokeIdentity(identity.ownerId);
    this.catalogs.clear();
    await Promise.all(
      this.options.store.mcp.list().map((server) => this.manager.invalidateServer(server.id)),
    );
  }

  private async connection(
    server: StoredMcpServer,
    scope: McpScope,
    readSecrets = true,
  ): Promise<McpConnectionBinding> {
    const identity = this.identity();
    const grant = this.options.store.mcp.grant(server.id, scope);
    if (
      !server.enabled ||
      grant === undefined ||
      grant.serverRevision !== server.revision ||
      grant.accessEpoch !== server.accessEpoch ||
      grant.ownerId !== identity.ownerId ||
      grant.identityEpoch !== identity.epoch
    )
      fail('MCP_DISABLED', '请先确认此隔离范围的启动授权。');
    const launch = await this.launch(server, scope, readSecrets);
    const preview = await this.previewLaunch(launch);
    this.expected(this.require(server.id), server.revision, server.accessEpoch);
    if (
      grant.workspaceRoot !== launch.workspaceRoot ||
      grant.startupFingerprint !== preview.startupFingerprint
    )
      fail('MCP_CONFLICT', '程序、工作区或启动环境已变化，请重新确认。');
    return {
      ownerId: identity.ownerId,
      identityEpoch: identity.epoch,
      serverId: server.id,
      serverRevision: server.revision,
      accessEpoch: server.accessEpoch,
      credentialEpoch: credentialEpoch(server),
      grantId: grant.id,
      startupFingerprint: grant.startupFingerprint,
      launch,
    };
  }
  private validateConnection(binding: McpConnectionBinding): void {
    const server = this.require(binding.serverId);
    this.expected(server, binding.serverRevision, binding.accessEpoch);
    const identity = this.identity();
    const grant = this.options.store.mcp.grant(server.id, binding.launch.scope);
    if (
      this.mutations.has(server.id) ||
      !server.enabled ||
      identity.ownerId !== binding.ownerId ||
      identity.epoch !== binding.identityEpoch ||
      credentialEpoch(server) !== binding.credentialEpoch ||
      grant?.id !== binding.grantId
    )
      fail('MCP_DISABLED', 'MCP启动授权已失效，请重新选择工具。');
  }
  public async discover(
    id: string,
    input: McpScopeInput,
    signal: AbortSignal,
  ): Promise<McpToolCatalog> {
    const server = this.require(id);
    this.expected(server, input.expectedRevision, input.expectedAccessEpoch);
    const binding = await this.connection(server, input.scope);
    this.validateConnection(binding);
    try {
      const value = await this.manager.discover(binding, { signal });
      this.validateConnection(binding);
      const entry = {
        revision: server.revision,
        accessEpoch: server.accessEpoch,
        startupFingerprint: binding.startupFingerprint,
        value,
        discoveredAt: Date.now(),
      };
      this.catalogs.set(`${id}:${input.scope}`, entry);
      this.diagnostics.delete(id);
      return this.catalogView(server, input.scope, entry);
    } catch (cause) {
      if (cause instanceof RuntimeError || cause instanceof StorageError) throw cause;
      this.diagnostics.set(id, 'MCP连接或工具发现失败，请检查启动配置与隔离范围。');
      fail('MCP_DISCOVERY_FAILED', 'MCP连接或工具发现失败，请检查启动配置与隔离范围。');
    }
  }
  private catalogView(
    server: StoredMcpServer,
    scope: McpScope,
    entry: CatalogEntry,
  ): McpToolCatalog {
    return {
      serverId: server.id,
      serverRevision: server.revision,
      scope,
      discoveredAt: entry.discoveredAt,
      tools: entry.value.tools.map((tool) => ({
        serverId: server.id,
        serverRevision: server.revision,
        remoteToolName: tool.remoteToolName,
        name: modelName(server.id, tool.remoteToolName),
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
  public catalog(id: string, scope: McpScope): McpToolCatalog | null {
    const server = this.require(id);
    const entry = this.catalogs.get(`${id}:${scope}`);
    if (
      entry === undefined ||
      !server.enabled ||
      entry.revision !== server.revision ||
      entry.accessEpoch !== server.accessEpoch
    )
      return null;
    return this.catalogView(server, scope, entry);
  }

  public async freezeSelections(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    workMode: 'execute' | 'plan',
    selections: readonly McpToolSelection[],
    signal: AbortSignal,
  ): Promise<FrozenMcpTool[]> {
    signal.throwIfAborted();
    if (selections.length === 0) return [];
    if (selections.length > 16 || workspaceId === null)
      fail('MCP_SELECTION_FORBIDDEN', '当前工作区或执行模式不能使用外部工具。');
    const scope: McpScope = approvalMode === 'full-access' ? 'full-access' : 'sandboxed';
    const seen = new Set<string>();
    const output: FrozenMcpTool[] = [];
    const connections = new Map<string, McpConnectionBinding>();
    for (const selection of selections) {
      const key = `${selection.serverId}:${selection.remoteToolName}`;
      if (seen.has(key)) fail('MCP_SELECTION_INVALID', '外部工具选择重复。');
      seen.add(key);
      const server = this.require(selection.serverId);
      this.expected(server, selection.serverRevision);
      if (server.workspaceId !== workspaceId)
        fail('MCP_SELECTION_FORBIDDEN', '外部工具不属于当前工作区。');
      let binding = connections.get(server.id);
      if (binding === undefined) {
        binding = await this.connection(server, scope, false);
        connections.set(server.id, binding);
      }
      this.validateConnection(binding);
      const entry = this.catalogs.get(`${server.id}:${scope}`);
      const tool = entry?.value.tools.find(
        (tool) => tool.remoteToolName === selection.remoteToolName,
      );
      if (
        entry === undefined ||
        entry.revision !== server.revision ||
        entry.accessEpoch !== server.accessEpoch ||
        entry.startupFingerprint !== binding.startupFingerprint ||
        tool === undefined ||
        !tool.supported ||
        tool.parameters === null ||
        tool.definitionFingerprint !== selection.definitionFingerprint
      )
        fail('MCP_SELECTION_STALE', '工具目录已失效，请重新发现并选择工具。');
      const control = this.options.store.mcp.directory.control(server.id, tool.remoteToolName);
      if (!control.enabled) fail('MCP_TOOL_DISABLED', '此工具已停用。');
      const readOnlyGrant = this.options.store.mcp.directory
        .grants(server.id)
        .find(
          (grant) =>
            grant.remoteToolName === tool.remoteToolName &&
            grant.serverRevision === server.revision &&
            grant.accessEpoch === server.accessEpoch &&
            grant.definitionFingerprint === tool.definitionFingerprint &&
            grant.toolControlRevision === control.revision &&
            grant.ownerId === binding.ownerId &&
            grant.identityEpoch === binding.identityEpoch,
        );
      if ((approvalMode === 'read-only' || workMode === 'plan') && readOnlyGrant === undefined)
        fail('MCP_SELECTION_FORBIDDEN', '此工具没有当前身份的精确只读授权。');
      signal.throwIfAborted();
      output.push({
        selection: { ...selection },
        definition: {
          name: modelName(server.id, tool.remoteToolName),
          description: tool.description,
          parameters: tool.parameters,
        },
        authorization: {
          ownerId: binding.ownerId,
          identityEpoch: binding.identityEpoch,
          accessEpoch: binding.accessEpoch,
          credentialEpoch: binding.credentialEpoch,
          grantId: binding.grantId,
          scope,
          workspaceId,
          workspaceRoot: binding.launch.workspaceRoot,
          startupFingerprint: binding.startupFingerprint,
          toolControlRevision: control.revision,
          ...(readOnlyGrant === undefined ? {} : { readOnlyGrantId: readOnlyGrant.id }),
        },
      });
    }
    await this.validateBindings(output, signal);
    return output;
  }
  /** Candidate freezing only reads the already discovered, trusted directory. */
  public async freezeCandidates(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    workMode: 'execute' | 'plan',
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]> {
    if (workspaceId === null) return [];
    const scope: McpScope = approvalMode === 'full-access' ? 'full-access' : 'sandboxed';
    const result: FrozenMcpTool[] = [];
    for (const server of this.list()) {
      if (
        server.workspaceId !== workspaceId ||
        !server.enabled ||
        !server.trustedScopes.includes(scope)
      )
        continue;
      const catalog = this.catalog(server.id, scope);
      if (catalog === null) continue;
      const selections = catalog.tools
        .filter(
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
        )
        .map((tool) => ({
          serverId: tool.serverId,
          serverRevision: tool.serverRevision,
          remoteToolName: tool.remoteToolName,
          definitionFingerprint: tool.definitionFingerprint,
        }));
      if (result.length + selections.length > 512)
        fail('MCP_CATALOG_LIMIT', '已启用工具目录超过512项，请停用不需要的工具。');
      for (let offset = 0; offset < selections.length; offset += 16)
        result.push(
          ...(await this.freezeSelections(
            workspaceId,
            approvalMode,
            workMode,
            selections.slice(offset, offset + 16),
            signal,
          )),
        );
    }
    return result;
  }
  public owns(id: string): boolean {
    return this.options.store.mcp.get(id) !== undefined;
  }

  public assertBindingsCurrent(tools: readonly FrozenMcpTool[]): void {
    for (const { selection, authorization, definition } of tools) {
      const server = this.require(selection.serverId);
      this.expected(server, selection.serverRevision, authorization.accessEpoch);
      const identity = this.identity();
      const grant = this.options.store.mcp.grant(server.id, authorization.scope);
      if (
        definition.name !== modelName(server.id, selection.remoteToolName) ||
        !server.enabled ||
        (authorization.readOnlyGrantId !== undefined &&
          !this.options.store.mcp.directory
            .grants(server.id)
            .some((grant) => grant.id === authorization.readOnlyGrantId)) ||
        !this.options.store.mcp.directory.control(server.id, selection.remoteToolName).enabled ||
        (authorization.toolControlRevision !== undefined &&
          this.options.store.mcp.directory.control(server.id, selection.remoteToolName).revision !==
            authorization.toolControlRevision) ||
        this.mutations.has(server.id) ||
        server.workspaceId !== authorization.workspaceId ||
        identity.ownerId !== authorization.ownerId ||
        identity.epoch !== authorization.identityEpoch ||
        credentialEpoch(server) !== authorization.credentialEpoch ||
        grant?.id !== authorization.grantId ||
        grant.workspaceRoot !== authorization.workspaceRoot ||
        grant.startupFingerprint !== authorization.startupFingerprint
      )
        fail('MCP_SELECTION_STALE', '原工具授权已失效，请重新选择工具。');
    }
  }
  public async restoreBindings(
    tools: readonly FrozenMcpTool[],
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]> {
    await this.validateBindings(tools, signal);
    return tools.map((tool) => {
      signal.throwIfAborted();
      const parameters = compileMcpInputSchema(tool.definition.parameters);
      const stable = (value: unknown): string =>
        JSON.stringify(value, (_key, item: unknown) => {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
          return Object.fromEntries(
            Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
          );
        });
      if (stable(parameters) !== stable(tool.definition.parameters))
        fail('MCP_BINDING_INVALID', '保存的工具定义无法等价恢复。');
      return {
        selection: { ...tool.selection },
        authorization: { ...tool.authorization },
        definition: { ...tool.definition, parameters },
      };
    });
  }
  public async validateBindings(
    tools: readonly FrozenMcpTool[],
    signal: AbortSignal,
  ): Promise<void> {
    this.assertBindingsCurrent(tools);
    const checked = new Set<string>();
    for (const tool of tools) {
      signal.throwIfAborted();
      const key = JSON.stringify([
        tool.selection.serverId,
        tool.authorization.scope,
        tool.authorization.grantId,
        tool.authorization.startupFingerprint,
        tool.authorization.credentialEpoch,
      ]);
      if (checked.has(key)) continue;
      checked.add(key);
      await this.boundConnection(tool, false);
    }
    signal.throwIfAborted();
  }
  private async boundConnection(
    frozen: FrozenMcpTool,
    readSecrets = true,
  ): Promise<McpConnectionBinding> {
    const { selection, authorization } = frozen;
    this.assertBindingsCurrent([frozen]);
    const server = this.require(selection.serverId);
    this.expected(server, selection.serverRevision, authorization.accessEpoch);
    const binding = await this.connection(server, authorization.scope, readSecrets);
    this.validateConnection(binding);
    if (
      binding.ownerId !== authorization.ownerId ||
      binding.identityEpoch !== authorization.identityEpoch ||
      binding.credentialEpoch !== authorization.credentialEpoch ||
      binding.grantId !== authorization.grantId ||
      binding.launch.workspaceRoot !== authorization.workspaceRoot ||
      binding.startupFingerprint !== authorization.startupFingerprint ||
      server.workspaceId !== authorization.workspaceId ||
      frozen.definition.name !== modelName(server.id, selection.remoteToolName)
    )
      fail('MCP_SELECTION_STALE', '原工具授权已失效，请重新选择工具。');
    return binding;
  }
  public async call(input: ExternalToolCall): Promise<ExternalToolOutcome> {
    const frozen = input.tool;
    const binding = await this.boundConnection(frozen);
    this.validateConnection(binding);
    const lease = await this.manager.acquire(binding, { signal: input.signal });
    const authority = new AbortController();
    const signal = AbortSignal.any([input.signal, authority.signal]);
    const checkAuthority = (): boolean => {
      try {
        this.validateConnection(binding);
        return true;
      } catch (error) {
        authority.abort(error);
        return false;
      }
    };
    try {
      this.validateConnection(binding);
      const current = lease.catalog.tools.find(
        (candidate) => candidate.remoteToolName === frozen.selection.remoteToolName,
      );
      if (
        current === undefined ||
        !current.supported ||
        current.definitionFingerprint !== frozen.selection.definitionFingerprint
      )
        return {
          kind: 'not-dispatched',
          cancelled: false,
          message: '工具定义已变化，请重新发现并选择工具。',
        };
      return await lease.call({
        arguments: input.arguments,
        callAttemptId: input.callAttemptId,
        signal,
        tool: current,
        beforeDispatch: async () => {
          if (!checkAuthority()) return;
          await input.beforeDispatch();
          checkAuthority();
        },
      });
    } finally {
      try {
        await lease.release();
      } catch {
        this.diagnostics.set(
          binding.serverId,
          '调用结果已记录，但MCP进程清理失败；请检查本机服务。',
        );
      }
    }
  }
  public metadata(id: string, scope: McpScope): McpMetadata | null {
    const server = this.require(id);
    if (this.catalog(id, scope) === null) return null;
    const entry = this.catalogs.get(`${server.id}:${scope}`);
    if (entry === undefined) return null;
    return mcpMetadata(entry.value);
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
  public isReadOnlyAuthorized(tool: FrozenMcpTool, args: Record<string, unknown>): boolean {
    return this.directory.authorized(tool, args);
  }
  /** Block new management and runtime operations before closing SDK-owned resources. */
  public stopAccepting(): void {
    this.closed = true;
  }
  public close(): Promise<void> {
    this.stopAccepting();
    this.closing ??= (async () => {
      const settled = await Promise.allSettled([this.manager.close(), ...this.pendingMutations]);
      const failures = settled
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason as unknown)
        .filter((error) => !(error instanceof RuntimeError && error.code === 'MCP_CLOSED'));
      if (failures.length > 0) throw new AggregateError(failures, 'MCP shutdown failed');
    })();
    return this.closing;
  }
}
