import type { DragEventHandler } from 'react';
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
  select: Action;
  rename: Action;
  remove: Action;
  className: string;
}

export interface WorkspaceTreeState {
  groups: WorkspaceGroup[];
  activeId: string | null;
  activeWorkspaceId: string | null;
  select: ValueChange<string>;
  selectWorkspace: ValueChange<string | null>;
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
