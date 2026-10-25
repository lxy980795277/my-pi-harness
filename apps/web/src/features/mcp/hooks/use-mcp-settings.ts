import type { McpSettingsState } from '@/features/mcp/types/mcp';
import { useCallback, useState } from 'react';
import type { McpServerView } from '@my-pi-harness/protocol';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { useMcpServers } from '@/features/mcp/hooks/use-mcp-servers';

/** Server lists stay in Query; the open editor retains only its observed revision until closed. */
export const useMcpSettings = (): McpSettingsState => {
  const servers = useMcpServers();
  const workspaces = useWorkspaces();
  const rows = (servers.data ?? []).map((server) => {
    const workspace = workspaces.data?.find((entry) => {
      return entry.id === server.workspaceId;
    });
    return { server, workspaceName: workspace?.name ?? '工作区不可用' };
  });
  const [editing, setEditing] = useState<McpServerView | null | undefined>(undefined);
  const create = useCallback((): void => {
    setEditing(null);
  }, []);
  const edit = useCallback((server: McpServerView): void => {
    setEditing(server);
  }, []);
  const close = useCallback((): void => {
    setEditing(undefined);
  }, []);
  let editorKey = 'new';
  if (editing) {
    editorKey = `${editing.id}:${editing.revision}`;
  }
  return { rows, servers, editing, editorKey, create, edit, close };
};
