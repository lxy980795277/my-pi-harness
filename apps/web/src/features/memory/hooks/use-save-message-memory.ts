import type { MessageView } from '@my-pi-harness/protocol';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MemoryEditorTarget, MessageMemoryEditorState } from '@/features/memory/types/memory';
import { WORKSPACES_QUERY_OPTIONS } from '@/features/workspaces/queries/workspaces';

/** Opening the editor freezes its visible message text; the daemon validates the source at save. */
export const useSaveMessageMemory = (
  workspaceId: string | null,
  branchId: string,
): MessageMemoryEditorState => {
  const [draft, setDraft] = useState<MemoryEditorTarget | null>(null);
  const workspaces = useQuery({ ...WORKSPACES_QUERY_OPTIONS, enabled: draft !== null });
  let workspaceName: string | null = null;
  for (const workspace of workspaces.data ?? []) {
    if (workspace.id === workspaceId) workspaceName = workspace.name;
  }
  const open = useCallback(
    (message: MessageView): void => {
      setDraft({ entry: null, message, workspaceId, workspaceName, branchId });
    },
    [branchId, workspaceId, workspaceName],
  );
  const close = useCallback((): void => {
    setDraft(null);
  }, []);
  let target: MemoryEditorTarget | null = null;
  if (draft !== null && draft.branchId === branchId && draft.workspaceId === workspaceId)
    target = draft;
  return { target, open, close };
};
