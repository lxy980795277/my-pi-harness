import type { RemoteMcpSettingsState } from '@/features/mcp/types/mcp';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { fetchRemoteMcpServers } from '@/features/mcp/services/remote-mcp';

/** Query owns remote configurations; each open editor retains its observed revision. */
export const useRemoteMcpSettings = (): RemoteMcpSettingsState => {
  const query = useQuery({
    queryKey: ['mcp', 'remote-servers'],
    queryFn: ({ signal }) => {
      return fetchRemoteMcpServers(signal);
    },
  });
  const [editing, setEditing] = useState<RemoteMcpView | null | undefined>(undefined);
  const open = useCallback((): void => {
    setEditing(null);
  }, []);
  const edit = useCallback((server: RemoteMcpView): void => {
    setEditing(server);
  }, []);
  const close = useCallback((): void => {
    setEditing(undefined);
  }, []);
  let editorKey = 'new';
  if (editing) {
    editorKey = `${editing.id}:${editing.revision}`;
  }
  return { query, editing, editorKey, open, edit, close };
};
