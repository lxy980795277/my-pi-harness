import type { Workspace } from '@my-pi-harness/protocol';
import { useCallback, useState } from 'react';
import type { WorkspaceGroup } from '@/features/workspaces/utils/workspace-tree';
import { cn } from '@/utils/cn';
import type { WorkspaceGroupState } from '@/features/workspaces/types/workspace-view';

/** Expansion is local presentation state; selecting a folder changes only the new-chat target. */
export const useWorkspaceGroup = (
  group: WorkspaceGroup,
  activeWorkspaceId: string | null,
  onSelect: (id: string | null) => void,
  onRename: (workspace: Workspace) => void,
  onRemove: (workspace: Workspace) => void,
): WorkspaceGroupState => {
  const [expanded, setExpanded] = useState(true);
  const select = useCallback((): void => {
    setExpanded((current) => {
      return !current;
    });
    onSelect(group.workspace?.id ?? null);
  }, [group.workspace?.id, onSelect]);
  const rename = useCallback((): void => {
    if (group.workspace) {
      onRename(group.workspace);
    }
  }, [group.workspace, onRename]);
  const remove = useCallback((): void => {
    if (group.workspace) {
      onRemove(group.workspace);
    }
  }, [group.workspace, onRemove]);
  let activeClass = '';
  if (group.workspace?.id === activeWorkspaceId) {
    activeClass = 'text-foreground';
  }
  return {
    expanded,
    select,
    rename,
    remove,
    className: cn(
      'group/folder h-8 min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 text-xs',
      activeClass,
    ),
  };
};
