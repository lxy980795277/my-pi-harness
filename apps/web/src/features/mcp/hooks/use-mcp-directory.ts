import type { McpDirectoryState, McpManagementTransport } from '@/features/mcp/types/mcp';
import { useCallback, useState, type ChangeEvent } from 'react';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { McpScope, McpToolView, McpReadOnlyGrantView } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  fetchManagedMcpTools,
  fetchMcpMetadata,
  fetchReadOnlyGrants,
  setManagedTool,
  grantManagedReadOnly,
  revokeManagedReadOnly,
} from '@/features/mcp/services/remote-mcp';
export interface McpDirectoryProps {
  serverId: string;
  revision: number;
  accessEpoch: number;
  scope: McpScope;
  transport: McpManagementTransport;
}

/** Metadata stays in Query; the exact-arguments authorization editor stays local. */
export const useMcpDirectory = (props: McpDirectoryProps): McpDirectoryState => {
  const { serverId, revision, accessEpoch, scope, transport } = props;
  const client = useQueryClient();
  let catalogKey: readonly unknown[] = ['mcp', 'tools', serverId, revision, scope];
  if (transport === 'remote') {
    catalogKey = ['mcp', 'remote-tools', serverId, revision];
  }
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: ({ signal }) => {
      return fetchManagedMcpTools(serverId, transport, scope, signal);
    },
  });
  const metadata = useQuery({
    queryKey: ['mcp', 'metadata', transport, serverId, revision, scope],
    queryFn: ({ signal }) => {
      return fetchMcpMetadata(serverId, transport, scope, signal);
    },
  });
  const grants = useQuery({
    queryKey: ['mcp', 'readonly-grants', serverId],
    queryFn: ({ signal }) => {
      return fetchReadOnlyGrants(serverId, transport, signal);
    },
  });
  const [tool, setTool] = useState<McpToolView | null>(null);
  const [args, setArgs] = useState('{}');
  const refresh = useCallback(async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['mcp'] });
  }, [client]);
  const control = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, tool: McpToolView): Promise<void> => {
        let enabled = true;
        if (tool.enabled !== false) {
          enabled = false;
        }
        await setManagedTool(serverId, transport, revision, accessEpoch, tool, enabled, signal);
        await refresh();
      },
      [accessEpoch, refresh, revision, serverId, transport],
    ),
  );
  const revoke = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, grant: McpReadOnlyGrantView): Promise<void> => {
        await revokeManagedReadOnly(serverId, transport, grant.id, signal);
        await refresh();
      },
      [refresh, serverId, transport],
    ),
  );
  const approve = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (tool === null) {
          return;
        }
        const value: unknown = JSON.parse(args);
        if (!Value.Check(Type.Record(Type.String(), Type.Unknown()), value)) {
          throw new Error('参数必须是JSON对象。');
        }
        await grantManagedReadOnly(serverId, transport, accessEpoch, tool, value, signal);
        await refresh();
        signal.throwIfAborted();
        setTool(null);
      },
      [accessEpoch, args, refresh, serverId, tool, transport],
    ),
  );
  const { run: controlRun } = control;
  const { run: revokeRun } = revoke;
  const rows = (catalog.data?.tools ?? []).map((entry) => {
    return {
      tool: entry,
      toggle: (): void => {
        controlRun(entry);
      },
      authorize: (): void => {
        setTool(entry);
        setArgs('{}');
      },
    };
  });
  const grantRows = (grants.data ?? []).map((entry) => {
    return {
      grant: entry,
      revoke: (): void => {
        revokeRun(entry);
      },
    };
  });
  const changeArgs = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setArgs(event.target.value);
  }, []);
  const close = useCallback((open: boolean): void => {
    if (!open) {
      setTool(null);
    }
  }, []);
  let error = control.error;
  if (error === null) {
    error = revoke.error;
  }
  if (error === null && catalog.error !== null) {
    error = catalog.error.message;
  }
  if (error === null && metadata.error !== null) {
    error = metadata.error.message;
  }
  if (error === null && grants.error !== null) {
    error = grants.error.message;
  }
  return {
    rows,
    hasCatalog: catalog.data !== null && catalog.data !== undefined,
    grantRows,
    metadata: metadata.data,
    tool,
    args,
    changeArgs,
    close,
    approve: approve.run,
    approvalError: approve.error,
    pending: control.pending || revoke.pending || approve.pending,
    error,
  };
};
