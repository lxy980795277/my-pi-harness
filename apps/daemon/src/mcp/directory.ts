import { createHash, randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { RuntimeError, type FrozenMcpTool } from '@my-pi-harness/agent-runtime';
import type { McpCatalog } from '@my-pi-harness/integrations';
import type { McpReadOnlyGrant, ProfileStore } from '@my-pi-harness/storage';
import type {
  McpToolControlInput,
  McpReadOnlyGrantInput,
  McpMetadata,
  McpToolControl,
  McpReadOnlyGrantView,
} from '@my-pi-harness/protocol';

interface DirectoryOwner {
  server(id: string): { revision: number; accessEpoch: number; enabled: boolean };
  identity(): { ownerId: string; epoch: number };
  catalogs(id: string): readonly McpCatalog[];
  invalidate(id: string): Promise<void>;
  assert(tools: readonly FrozenMcpTool[]): void;
}

function mcpArgumentsHash(value: Record<string, unknown>): string {
  const encoded = JSON.stringify(value, (_key, entry: unknown) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
    return entry;
  });
  return createHash('sha256').update(encoded).digest('hex');
}

export function mcpMetadata(catalog: McpCatalog): McpMetadata {
  return {
    resources: (catalog.resources ?? []).map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      ...(resource.description === undefined
        ? {}
        : { description: resource.description.slice(0, 16000) }),
      ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    })),
    prompts: (catalog.prompts ?? []).map((prompt) => ({
      name: prompt.name,
      ...(prompt.description === undefined
        ? {}
        : { description: prompt.description.slice(0, 16000) }),
      arguments: (prompt.arguments ?? []).map((argument) => ({
        name: argument.name,
        ...(argument.description === undefined
          ? {}
          : { description: argument.description.slice(0, 16000) }),
        required: argument.required === true,
      })),
    })),
  };
}

/** User grants bind one tool definition and exact arguments; annotations never grant authority. */
export class McpDirectoryPolicy {
  public constructor(
    private readonly store: ProfileStore,
    private readonly owner: DirectoryOwner,
  ) {}
  public async setControl(id: string, input: McpToolControlInput): Promise<McpToolControl> {
    const server = this.owner.server(id);
    if (
      server.revision !== input.expectedRevision ||
      server.accessEpoch !== input.expectedAccessEpoch
    )
      throw new RuntimeError('MCP_CONFLICT', 'MCP配置或授权已变化。');
    const result = this.store.mcp.directory.setControl(id, input.remoteToolName, input.enabled);
    await this.owner.invalidate(id);
    return result;
  }
  public grant(id: string, input: McpReadOnlyGrantInput): { id: string } {
    const server = this.owner.server(id);
    const identity = this.owner.identity();
    if (
      input.serverId !== id ||
      server.revision !== input.serverRevision ||
      server.accessEpoch !== input.expectedAccessEpoch
    )
      throw new RuntimeError('MCP_CONFLICT', '工具来源或配置已变化。');
    const tool = this.owner
      .catalogs(id)
      .flatMap((catalog) => catalog.tools)
      .find(
        (entry) =>
          entry.remoteToolName === input.remoteToolName &&
          entry.definitionFingerprint === input.definitionFingerprint &&
          entry.supported,
      );
    const stack: { value: unknown; depth: number }[] = [{ value: input.arguments, depth: 0 }];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) break;
      if (next.depth > 32)
        throw new RuntimeError('MCP_ARGUMENTS_LIMIT', '只读授权参数嵌套超过限制。');
      if (next.value !== null && typeof next.value === 'object')
        for (const value of Object.values(next.value)) stack.push({ value, depth: next.depth + 1 });
    }
    if (Buffer.byteLength(JSON.stringify(input.arguments)) > 65536)
      throw new RuntimeError('MCP_ARGUMENTS_LIMIT', '只读授权参数超过64KiB。');
    const control = this.store.mcp.directory.control(id, input.remoteToolName);
    if (
      tool === undefined ||
      tool.parameters === null ||
      !control.enabled ||
      !server.enabled ||
      !Value.Check(tool.parameters, input.arguments)
    )
      throw new RuntimeError('MCP_SELECTION_STALE', '当前工具定义或参数无效。');
    for (const grant of this.store.mcp.directory.grants(id))
      if (grant.remoteToolName === input.remoteToolName)
        this.store.mcp.directory.revoke(id, grant.id);
    const grantId = randomUUID();
    this.store.mcp.directory.grant({
      id: grantId,
      serverId: id,
      remoteToolName: input.remoteToolName,
      serverRevision: server.revision,
      accessEpoch: server.accessEpoch,
      definitionFingerprint: input.definitionFingerprint,
      argumentsHash: mcpArgumentsHash(input.arguments),
      ownerId: identity.ownerId,
      identityEpoch: identity.epoch,
      toolControlRevision: control.revision,
      grantedAt: Date.now(),
    });
    return { id: grantId };
  }
  public list(id: string): McpReadOnlyGrantView[] {
    this.owner.server(id);
    return this.store.mcp.directory.grants(id).map((grant) => ({
      id: grant.id,
      remoteToolName: grant.remoteToolName,
      argumentsHash: grant.argumentsHash,
      definitionFingerprint: grant.definitionFingerprint,
      grantedAt: grant.grantedAt,
    }));
  }
  public async revoke(id: string, grantId: string): Promise<void> {
    this.owner.server(id);
    this.store.mcp.directory.revoke(id, grantId);
    await this.owner.invalidate(id);
  }
  /** Finds a grant for the current definition, identity, configuration and tool control. */
  public currentGrant(
    serverId: string,
    remoteToolName: string,
    definitionFingerprint: string,
    grantId?: string,
  ): McpReadOnlyGrant | undefined {
    const server = this.owner.server(serverId);
    const identity = this.owner.identity();
    const control = this.store.mcp.directory.control(serverId, remoteToolName);
    if (!server.enabled || !control.enabled) return undefined;
    return this.store.mcp.directory
      .grants(serverId)
      .find(
        (grant) =>
          (grantId === undefined || grant.id === grantId) &&
          grant.remoteToolName === remoteToolName &&
          grant.serverRevision === server.revision &&
          grant.accessEpoch === server.accessEpoch &&
          grant.definitionFingerprint === definitionFingerprint &&
          grant.ownerId === identity.ownerId &&
          grant.identityEpoch === identity.epoch &&
          grant.toolControlRevision === control.revision,
      );
  }
  public authorized(tool: FrozenMcpTool, args: Record<string, unknown>): boolean {
    try {
      this.owner.assert([tool]);
    } catch {
      return false;
    }
    const grantId = tool.authorization.readOnlyGrantId;
    if (grantId === undefined) return false;
    const grant = this.currentGrant(
      tool.selection.serverId,
      tool.selection.remoteToolName,
      tool.selection.definitionFingerprint,
      grantId,
    );
    return (
      grant !== undefined &&
      grant.id === tool.authorization.readOnlyGrantId &&
      grant.toolControlRevision === tool.authorization.toolControlRevision &&
      grant.argumentsHash === mcpArgumentsHash(args)
    );
  }
}
