import type { DragEventHandler, RefObject } from 'react';
import type { Workspace, WorkspaceIcon } from '@my-pi-harness/protocol';
import type { WorkspaceGroup } from '@/features/workspaces/utils/workspace-tree';
import type { Action, FormSubmit, InputChange, ValueChange } from '@/types/view-events';

export interface WorkspaceDialogState {
  title: string;
  name: string;
  rootPath: string;
  changeName: InputChange;
  icon: WorkspaceIcon;
  directoryName: string;
  changeIcon: ValueChange<WorkspaceIcon>;
  submit: FormSubmit;
  changeOpen: ValueChange<boolean>;
  choose: Action;
  editableDirectory: boolean;
  directoryAvailable: boolean;
  dragging: boolean;
  dragEnter: DragEventHandler<HTMLDivElement>;
  dragLeave: DragEventHandler<HTMLDivElement>;
  dragOver: DragEventHandler<HTMLDivElement>;
  drop: DragEventHandler<HTMLDivElement>;
  directoryPending: boolean;
  saving: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
}

export interface WorkspaceGroupState {
  expanded: boolean;
  toggle: Action;
  rename: Action;
  remove: Action;
  newConversation: Action;
  menuOpen: boolean;
  changeMenuOpen: ValueChange<boolean>;
  menuTrigger: RefObject<HTMLButtonElement | null>;
  closeMenuFocus: (event: Event) => void;
  rowClassName: string;
  actionsClassName: string;
  className: string;
}

export interface WorkspaceTreeState {
  groups: WorkspaceGroup[];
  activeId: string | null;
  activeWorkspaceId: string | null;
  select: ValueChange<string>;
  newConversation: ValueChange<string | null>;
  add: Action;
  rename: ValueChange<Workspace>;
  dialog: { workspace: Workspace | null } | null;
  closeDialog: Action;
  requestRemove: ValueChange<Workspace>;
  removing: Workspace | null;
  confirmRemove: Action;
  cancelRemove: Action;
  changeRemoveOpen: ValueChange<boolean>;
  removingPending: boolean;
  removeError: string | null;
  pending: boolean;
  error: string | null;
}
