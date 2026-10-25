import type {
  ApprovalMode,
  McpScope,
  McpServerView,
  McpToolCatalog,
  McpToolSelection,
  McpToolView,
} from '@my-pi-harness/protocol';

export const EMPTY_MCP_SELECTIONS: McpToolSelection[] = [];

/** Isolation is derived from approval policy, never from a server's tool annotations. */
export const mcpScope = (approval: ApprovalMode): McpScope => {
  if (approval === 'full-access') {
    return 'full-access';
  }
  return 'sandboxed';
};

/** Selection identity includes the accepted revision and exact discovered definition. */
export const mcpSelectionKey = (tool: McpToolSelection): string => {
  return JSON.stringify([
    tool.serverId,
    tool.serverRevision,
    tool.remoteToolName,
    tool.definitionFingerprint,
  ]);
};

/** Copies only public immutable selection fields; runtime tool names are not routing identifiers. */
export const selectMcpTool = (tool: McpToolView): McpToolSelection => {
  return {
    serverId: tool.serverId,
    serverRevision: tool.serverRevision,
    remoteToolName: tool.remoteToolName,
    definitionFingerprint: tool.definitionFingerprint,
  };
};

/** A stale selection remains visible and rejected until the user explicitly removes or reselects it. */
export const invalidMcpSelections = (
  selected: McpToolSelection[],
  servers: McpServerView[],
  catalogs: (McpToolCatalog | null | undefined)[],
  workspaceId: string | null,
  scope: McpScope,
): McpToolSelection[] => {
  return selected.filter((selection) => {
    const server = servers.find((entry) => {
      return entry.id === selection.serverId;
    });
    if (
      !server ||
      server.workspaceId !== workspaceId ||
      !server.enabled ||
      !server.trustedScopes.includes(scope) ||
      server.revision !== selection.serverRevision
    ) {
      return true;
    }
    const catalog = catalogs.find((entry) => {
      return (
        entry?.serverId === selection.serverId &&
        entry.scope === scope &&
        entry.serverRevision === selection.serverRevision
      );
    });
    return !catalog?.tools.some((tool) => {
      return tool.available && mcpSelectionKey(tool) === mcpSelectionKey(selection);
    });
  });
};
