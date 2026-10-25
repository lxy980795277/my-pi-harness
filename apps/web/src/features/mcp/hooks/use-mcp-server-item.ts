import type { McpServerItemState } from '@/features/mcp/types/mcp';
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { McpScope, McpServerView, McpTrustPreview } from '@my-pi-harness/protocol';
import {
  controlMcpServer,
  deleteMcpServer,
  discoverMcpTools,
  fetchMcpTools,
  previewMcpTrust,
  trustMcpServer,
} from '@/features/mcp/services/mcp';
import type { McpControlAction, McpDiscoveryAction } from '@/features/mcp/types/mcp';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Startup and explicit discovery are user actions; cached catalogs alone are queried automatically. */
export const useMcpServerItem = (
  server: McpServerView,
  onEdit: (server: McpServerView) => void,
): McpServerItemState => {
  const client = useQueryClient();
  const [scope, setScope] = useState<McpScope>('sandboxed');
  const [preview, setPreview] = useState<McpTrustPreview | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const catalog = useQuery({
    queryKey: ['mcp', 'tools', server.id, server.revision, scope],
    queryFn: ({ signal }) => {
      return fetchMcpTools(server.id, scope, signal);
    },
  });
  const refresh = useCallback(async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['mcp'] });
  }, [client]);
  const startup = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const result = await previewMcpTrust(
          server.id,
          { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch, scope },
          signal,
        );
        signal.throwIfAborted();
        setPreview(result);
      },
      [scope, server],
    ),
  );
  const trust = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (preview === null) {
          return;
        }
        await trustMcpServer(
          server.id,
          {
            expectedRevision: preview.revision,
            expectedAccessEpoch: preview.accessEpoch,
            scope: preview.scope,
            startupFingerprint: preview.startupFingerprint,
          },
          signal,
        );
        await refresh();
        signal.throwIfAborted();
        setPreview(null);
      },
      [preview, refresh, server.id],
    ),
  );
  const discover = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, action: McpDiscoveryAction): Promise<void> => {
        const result = await discoverMcpTools(
          server.id,
          action,
          { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch, scope },
          signal,
        );
        client.setQueryData(['mcp', 'tools', server.id, server.revision, scope], result);
        await client.invalidateQueries({ queryKey: ['mcp'] });
      },
      [client, scope, server],
    ),
  );
  const control = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, action: McpControlAction): Promise<void> => {
        await controlMcpServer(
          server.id,
          action,
          { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch },
          signal,
        );
        await refresh();
      },
      [refresh, server],
    ),
  );
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await deleteMcpServer(server, signal);
        await refresh();
      },
      [refresh, server],
    ),
  );
  const { run: discoverRun } = discover;
  const { run: controlRun } = control;
  const changeScope = useCallback((value: string): void => {
    if (value === 'sandboxed' || value === 'full-access') {
      setScope(value);
      setPreview(null);
    }
  }, []);
  const discoverTools = useCallback((): void => {
    discoverRun('discover');
  }, [discoverRun]);
  const test = useCallback((): void => {
    discoverRun('test');
  }, [discoverRun]);
  const disable = useCallback((): void => {
    controlRun('disable');
  }, [controlRun]);
  const revoke = useCallback((): void => {
    controlRun('revoke-trust');
  }, [controlRun]);
  const edit = useCallback((): void => {
    onEdit(server);
  }, [onEdit, server]);
  const openDelete = useCallback((): void => {
    setDeleteOpen(true);
  }, []);
  const closeTrust = useCallback((open: boolean): void => {
    if (!open) {
      setPreview(null);
    }
  }, []);
  const openSecrets = useCallback((): void => {
    setSecretsOpen(true);
  }, []);
  const closeSecrets = useCallback((): void => {
    setSecretsOpen(false);
  }, []);
  let error = startup.error;
  if (error === null) {
    error = discover.error;
  }
  if (error === null) {
    error = control.error;
  }
  if (error === null && catalog.error !== null) {
    error = catalog.error.message;
  }
  const trusted = server.enabled && server.trustedScopes.includes(scope);
  return {
    scope,
    changeScope,
    catalog: catalog.data,
    preview,
    startup: startup.run,
    trust: trust.run,
    closeTrust,
    discoverTools,
    test,
    disable,
    revoke,
    edit,
    openDelete,
    deleteOpen,
    changeDeleteOpen: setDeleteOpen,
    remove: remove.run,
    deleteError: remove.error,
    trustError: trust.error,
    secretsOpen,
    openSecrets,
    closeSecrets,
    trusted,
    pending:
      startup.pending || trust.pending || discover.pending || control.pending || remove.pending,
    error,
  };
};
