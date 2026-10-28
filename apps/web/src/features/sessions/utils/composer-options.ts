import type { Attachment, ApprovalMode, Workspace } from '@my-pi-harness/protocol';
import { createElement } from 'react';
import { WorkspaceIcon } from '@/components/workspace-icon';
import type { SelectOption } from '@/components/ui/select-field';

export const NO_WORKSPACE = 'no-workspace';
/** Workspace options use only host registrations; an absent choice never grants cwd access. */
export const buildWorkspaceOptions = (workspaces: readonly Workspace[]): SelectOption[] => {
  return [
    { value: NO_WORKSPACE, label: '不使用工作区' },
    ...workspaces.map((workspace) => {
      return {
        value: workspace.id,
        label: workspace.name,
        icon: createElement(WorkspaceIcon, { icon: workspace.icon }),
      };
    }),
  ];
};

/** A short initial title is derived from the user's first message, not a separate creation form. */
export const titleFromFirstMessage = (
  text: string,
  attachments: Pick<Attachment, 'name'>[] = [],
): string => {
  const title = text.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (title) {
    return title;
  }
  return (attachments[0]?.name ?? '新对话').slice(0, 60);
};

/** Keeps legacy read-only records readable while accepting the three current execution policies. */
export const readApprovalMode = (value: string): ApprovalMode | null => {
  if (value === 'ask' || value === 'auto' || value === 'full-access' || value === 'read-only') {
    return value;
  }
  return null;
};
