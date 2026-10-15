import type {
  ApprovalMode,
  DefaultModel,
  ProviderConfig,
  Workspace,
} from '@my-pi-harness/protocol';
import { createElement } from 'react';
import { WorkspaceIcon } from '@/components/workspace-icon';
import type { SelectOption } from '@/components/ui/select-field';
import {
  buildAvailableModelOptions,
  modelSelectionKey,
} from '@/features/models/utils/model-options';

export const NO_WORKSPACE = 'no-workspace';
export const APPROVAL_OPTIONS: SelectOption[] = [
  { value: 'ask', label: '请求批准', description: '读取工作区自动执行，修改与命令逐次批准' },
  { value: 'read-only', label: '只读', description: '禁止文件修改和 Shell 执行' },
];

/** Workspace options use only host registrations; an absent choice never grants cwd access. */
export const buildWorkspaceOptions = (workspaces: readonly Workspace[]): SelectOption[] => {
  return [
    { value: NO_WORKSPACE, label: '不使用工作区' },
    ...workspaces.map((workspace) => {
      return {
        value: workspace.id,
        label: workspace.name,
        description: workspace.rootPath,
        icon: createElement(WorkspaceIcon, { icon: workspace.icon }),
      };
    }),
  ];
};

/** Keeps a historical model visible without silently substituting an available alternative. */
export const buildComposerModelOptions = (
  providers: readonly ProviderConfig[],
  selection: DefaultModel | null,
): SelectOption[] => {
  const options = buildAvailableModelOptions(providers);
  if (selection) {
    const key = modelSelectionKey(selection.providerId, selection.modelId);
    if (
      !options.some((option) => {
        return option.value === key;
      })
    ) {
      options.push({ value: key, label: `${selection.modelId}（当前配置不可用）`, disabled: true });
    }
  }
  return options;
};

/** A short initial title is derived from the user's first message, not a separate creation form. */
export const titleFromFirstMessage = (text: string): string => {
  return text.trim().replace(/\s+/g, ' ').slice(0, 60);
};

/** Select values must match the two actual execution policies. */
export const readApprovalMode = (value: string): ApprovalMode | null => {
  if (value === 'ask' || value === 'read-only') {
    return value;
  }
  return null;
};
