import { useCallback, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type {
  ApprovalMode,
  McpToolCatalog,
  McpToolSelection,
  McpToolView,
} from '@my-pi-harness/protocol';
import { useMcpServers } from '@/features/mcp/hooks/use-mcp-servers';
import { fetchMcpTools } from '@/features/mcp/services/mcp';
import { fetchRemoteMcpServers, fetchManagedMcpTools } from '@/features/mcp/services/remote-mcp';
import { useSettingsStore } from '@/features/settings/stores/settings';
import { mcpScope, mcpSelectionKey, selectMcpTool } from '@/features/mcp/utils/mcp-selection';
import type { McpSelectionState } from '@/features/mcp/types/mcp';

/** Validates explicit draft choices against Query-owned catalogs without changing stale selections. */
export const useMcpSelection = (
  selected: McpToolSelection[],
  changeSelection: (tools: McpToolSelection[]) => void,
  workspaceId: string | null,
  approval: ApprovalMode,
  locked: boolean,
  enabled = true,
): McpSelectionState => {
  const [open, setOpen] = useState(false);
  const openSettings = useSettingsStore((state) => {
    return state.openSettings;
  });
  const scope = mcpScope(approval);
  const reading = enabled && (open || selected.length > 0);
  const servers = useMcpServers(workspaceId !== null && reading);
  const remoteServers = useQuery({
    queryKey: ['mcp', 'remote-servers'],
    queryFn: ({ signal }) => {
      return fetchRemoteMcpServers(signal);
    },
    enabled: reading,
  });
  const availableServers = (servers.data ?? []).filter((server) => {
    return (
      reading &&
      server.workspaceId === workspaceId &&
      server.enabled &&
      server.trustedScopes.includes(scope)
    );
  });
  const catalogs = useQueries({
    queries: [
      ...availableServers.map((server) => {
        return {
          queryKey: ['mcp', 'tools', server.id, server.revision, scope],
          queryFn: ({ signal }: { signal: AbortSignal }): Promise<McpToolCatalog | null> => {
            return fetchMcpTools(server.id, scope, signal);
          },
        };
      }),
      ...(remoteServers.data ?? [])
        .filter((server) => {
          return reading && server.enabled && server.trusted;
        })
        .map((server) => {
          return {
            queryKey: ['mcp', 'remote-tools', server.id, server.revision],
            queryFn: ({ signal }: { signal: AbortSignal }): Promise<McpToolCatalog | null> => {
              return fetchManagedMcpTools(server.id, 'remote', scope, signal);
            },
          };
        }),
    ],
  });
  const invalid = selected.filter((selection) => {
    return !catalogs.some((query) => {
      return query.data?.tools.some((tool) => {
        return tool.available && mcpSelectionKey(tool) === mcpSelectionKey(selection);
      });
    });
  });
  const choose = useCallback(
    (tool: McpToolView): void => {
      if (locked) {
        return;
      }
      const key = mcpSelectionKey(tool);
      const existing = selected.some((entry) => {
        return mcpSelectionKey(entry) === key;
      });
      if (existing) {
        changeSelection(
          selected.filter((entry) => {
            return mcpSelectionKey(entry) !== key;
          }),
        );
      } else if (
        (approval !== 'read-only' || tool.readOnlyAuthorized === true) &&
        tool.available &&
        selected.length < 16
      ) {
        changeSelection([...selected, selectMcpTool(tool)]);
      }
    },
    [approval, changeSelection, locked, selected],
  );
  const rows = catalogs.flatMap((query) => {
    if (!query.data) {
      return [];
    }
    const server = [
      ...availableServers,
      ...(remoteServers.data ?? []).filter((entry) => {
        return entry.enabled && entry.trusted;
      }),
    ].find((entry) => {
      return entry.id === query.data?.serverId;
    });
    if (!server) {
      return [];
    }
    return query.data.tools.map((tool) => {
      const key = mcpSelectionKey(tool);
      const isSelected = selected.some((entry) => {
        return mcpSelectionKey(entry) === key;
      });
      return {
        key,
        serverName: server.name,
        tool,
        selected: isSelected,
        disabled:
          locked ||
          (!isSelected &&
            ((approval === 'read-only' && tool.readOnlyAuthorized !== true) ||
              !tool.available ||
              selected.length >= 16)),
        change: (): void => {
          choose(tool);
        },
      };
    });
  });
  const openPicker = useCallback((): void => {
    setOpen(true);
  }, []);
  const removeInvalid = useCallback((): void => {
    if (locked) {
      return;
    }
    const invalidKeys = new Set(invalid.map(mcpSelectionKey));
    changeSelection(
      selected.filter((entry) => {
        return !invalidKeys.has(mcpSelectionKey(entry));
      }),
    );
  }, [changeSelection, invalid, locked, selected]);
  const settings = useCallback((): void => {
    setOpen(false);
    openSettings('mcp');
  }, [openSettings]);
  let error: string | null = null;
  if (servers.error !== null) {
    error = servers.error.message;
  }
  if (error === null && remoteServers.error !== null) {
    error = remoteServers.error.message;
  }
  for (const catalog of catalogs) {
    if (error === null && catalog.error !== null) {
      error = catalog.error.message;
    }
  }
  const loading =
    reading &&
    ((workspaceId !== null && servers.isPending) ||
      remoteServers.isPending ||
      catalogs.some((query) => {
        return query.isPending;
      }));
  const blocked = selected.length > 0 && (loading || error !== null || invalid.length > 0);
  return {
    selected,
    rows,
    invalid,
    blocked,
    locked,
    open,
    loading,
    error,
    openPicker,
    changeOpen: setOpen,
    removeInvalid,
    settings,
    scope,
    workspaceMissing: workspaceId === null,
    readOnly: approval === 'read-only',
  };
};
