import type { Workspace } from '@my-pi-harness/protocol';
import { useCallback, useRef, useState } from 'react';
import type { WorkspaceGroup } from '@/features/workspaces/utils/workspace-tree';
import { cn } from '@/utils/cn';
import type { WorkspaceGroupState } from '@/features/workspaces/types/workspace';

/** Expansion changes presentation only; the explicit plus action chooses a fresh conversation target. */
export const useWorkspaceGroup = (
  group: WorkspaceGroup,
  onNewConversation: (id: string | null) => void,
  onRename: (workspace: Workspace) => void,
  onRemove: (workspace: Workspace) => void,
): WorkspaceGroupState => {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const transferringFocus = useRef(false);
  const toggle = useCallback((): void => {
    setExpanded((current): boolean => {
      return !current;
    });
  }, []);
  const changeMenuOpen = useCallback((open: boolean): void => {
    if (open) {
      transferringFocus.current = false;
    }
    setMenuOpen(open);
  }, []);
  const closeMenuFocus = useCallback((event: Event): void => {
    if (transferringFocus.current) {
      event.preventDefault();
      transferringFocus.current = false;
    }
  }, []);
  const rename = useCallback((): void => {
    if (!group.workspace) {
      return;
    }
    transferringFocus.current = true;
    menuTrigger.current?.focus({ preventScroll: true });
    setMenuOpen(false);
    onRename(group.workspace);
  }, [group.workspace, onRename]);
  const remove = useCallback((): void => {
    if (!group.workspace) {
      return;
    }
    transferringFocus.current = true;
    menuTrigger.current?.focus({ preventScroll: true });
    setMenuOpen(false);
    onRemove(group.workspace);
  }, [group.workspace, onRemove]);
  const newConversation = useCallback((): void => {
    transferringFocus.current = menuOpen;
    setMenuOpen(false);
    onNewConversation(group.workspace?.id ?? null);
  }, [group.workspace?.id, menuOpen, onNewConversation]);
  let titlePadding = 'pr-10';
  if (group.workspace) {
    titlePadding = 'pr-16';
  }
  return {
    expanded,
    toggle,
    rename,
    remove,
    newConversation,
    menuOpen,
    changeMenuOpen,
    menuTrigger,
    closeMenuFocus,
    rowClassName: cn(
      'group/workspace relative rounded-lg hover:bg-muted has-[:focus-visible]:bg-muted',
      {
        'bg-muted': menuOpen,
      },
    ),
    actionsClassName: cn(
      'pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-none group-has-[:focus-visible]/workspace:pointer-events-auto group-has-[:focus-visible]/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100',
      { 'pointer-events-auto opacity-100': menuOpen },
    ),
    className: cn(
      'group/folder h-8 w-full min-w-0 justify-start gap-2 rounded-lg pl-2 text-left text-xs transition-none hover:bg-transparent',
      titlePadding,
    ),
  };
};
