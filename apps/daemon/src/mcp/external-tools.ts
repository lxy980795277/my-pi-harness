import {
  RuntimeError,
  type ExternalTools,
  type FrozenMcpTool,
  type ToolDiscoveryPort,
} from '@my-pi-harness/agent-runtime';
import type { McpToolSelection } from '@my-pi-harness/protocol';
import type { McpService } from './service.js';
import type { RemoteMcpService } from './remote-service.js';

/** Combines separately owned transports without interpreting aliases as execution identities. */
export function createExternalToolPorts(
  local: McpService,
  remote: RemoteMcpService,
): ExternalTools & ToolDiscoveryPort {
  const owner = (serverId: string): McpService | RemoteMcpService => {
    if (local.owns(serverId)) return local;
    if (remote.owns(serverId)) return remote;
    throw new RuntimeError('MCP_SERVER_NOT_FOUND', 'MCP Server不存在。');
  };
  const groupSelections = (selections: readonly McpToolSelection[]) => {
    const groups = new Map<McpService | RemoteMcpService, McpToolSelection[]>();
    for (const selection of selections) {
      const service = owner(selection.serverId);
      const items = groups.get(service) ?? [];
      items.push(selection);
      groups.set(service, items);
    }
    return groups;
  };
  const groupTools = (tools: readonly FrozenMcpTool[]) => {
    const groups = new Map<McpService | RemoteMcpService, FrozenMcpTool[]>();
    for (const tool of tools) {
      const service = owner(tool.selection.serverId);
      const items = groups.get(service) ?? [];
      items.push(tool);
      groups.set(service, items);
    }
    return groups;
  };
  return {
    diagnostics: (workspaceId, approvalMode) => [
      ...local.diagnostics(workspaceId, approvalMode),
      ...remote.diagnostics(),
    ],
    async freezeSelections(workspaceId, approvalMode, selections, signal) {
      const frozen: FrozenMcpTool[] = [];
      for (const [service, items] of groupSelections(selections))
        frozen.push(...(await service.freezeSelections(workspaceId, approvalMode, items, signal)));
      return frozen;
    },
    async freezeCandidates(workspaceId, approvalMode, signal) {
      const candidates = [
        ...(await local.freezeCandidates(workspaceId, approvalMode, signal)),
        ...(await remote.freezeCandidates(workspaceId, approvalMode, signal)),
      ];
      if (candidates.length > 512 || JSON.stringify(candidates).length > 4_000_000)
        throw new RuntimeError('MCP_CATALOG_LIMIT', '已授权MCP目录过大，请先停用不需要的工具。');
      return candidates;
    },
    async validateBindings(tools, signal) {
      for (const [service, items] of groupTools(tools))
        await service.validateBindings(items, signal);
    },
    async restoreBindings(tools, signal) {
      const frozen: FrozenMcpTool[] = [];
      for (const [service, items] of groupTools(tools))
        frozen.push(...(await service.restoreBindings(items, signal)));
      return frozen;
    },
    assertBindingsCurrent(tools) {
      for (const [service, items] of groupTools(tools)) service.assertBindingsCurrent(items);
    },
    isReadOnlyAuthorized(tool, args) {
      return owner(tool.selection.serverId).isReadOnlyAuthorized(tool, args);
    },
    call(input) {
      return owner(input.tool.selection.serverId).call(input);
    },
  };
}
