import type { AgentRole, ProviderConfig } from '@my-pi-harness/protocol';
import { useCallback, type ChangeEvent } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { AgentRoleEditorState } from '@/features/tasks/types/tasks';
import { useProviderModels } from '@/features/models/hooks/use-model-catalog';
import {
  buildAvailableModelOptions,
  buildThinkingOptions,
  findModelSelection,
  modelSelectionKey,
  resolveThinkingLevel,
  THINKING_LABELS,
} from '@/features/models/utils/model-options';

const ACCESS_OPTIONS = [
  { value: 'read-only', label: '只读调查与审查' },
  { value: 'write', label: '允许受控写入' },
];

/** Role capabilities only narrow the parent execution's host-enforced permissions. */
export const useAgentRoleEditor = (
  role: AgentRole,
  providers: readonly ProviderConfig[],
  onChange: (role: AgentRole) => void,
): AgentRoleEditorState => {
  const provider = providers.find((entry) => {
    return entry.id === role.providerId;
  });
  const models = useProviderModels(role.providerId ?? '', provider?.revision);
  const model = models.data?.find((entry) => {
    return entry.id === role.modelId;
  });
  const changeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      onChange({ ...role, name: event.target.value });
    },
    [onChange, role],
  );
  const changeDescription = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      onChange({ ...role, description: event.target.value });
    },
    [onChange, role],
  );
  const changeInstructions = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      onChange({ ...role, instructions: event.target.value });
    },
    [onChange, role],
  );
  const changeEnabled = useCallback(
    (enabled: boolean): void => {
      onChange({ ...role, enabled });
    },
    [onChange, role],
  );
  const changeAccess = useCallback(
    (value: string): void => {
      if (value === 'read-only' || value === 'write') onChange({ ...role, access: value });
    },
    [onChange, role],
  );
  const changeModel = useCallback(
    (value: string): void => {
      if (value === 'inherit') {
        onChange({ ...role, providerId: null, modelId: null, thinkingLevel: null });
        return;
      }
      const selected = findModelSelection(providers, value);
      if (selected !== null) onChange({ ...role, ...selected });
    },
    [onChange, providers, role],
  );
  const changeThinking = useCallback(
    (value: string): void => {
      if (value === 'inherit') onChange({ ...role, thinkingLevel: null });
      else onChange({ ...role, thinkingLevel: resolveThinkingLevel(value, model) });
    },
    [model, onChange, role],
  );
  let modelValue = 'inherit';
  if (role.providerId !== null && role.modelId !== null)
    modelValue = modelSelectionKey(role.providerId, role.modelId);
  const modelOptions: SelectOption[] = [
    { value: 'inherit', label: '继承父执行模型' },
    ...buildAvailableModelOptions(providers),
  ];
  if (
    !modelOptions.some((option) => {
      return option.value === modelValue;
    })
  )
    modelOptions.push({
      value: modelValue,
      label: `${role.providerId} · ${role.modelId}（当前不可用）`,
      disabled: true,
    });
  const thinkingOptions: SelectOption[] = [{ value: 'inherit', label: '继承父执行' }];
  if (role.modelId !== null) thinkingOptions.push(...buildThinkingOptions(model));
  if (
    role.thinkingLevel !== null &&
    !thinkingOptions.some((option) => {
      return option.value === role.thinkingLevel;
    })
  )
    thinkingOptions.push({
      value: role.thinkingLevel,
      label: `${THINKING_LABELS[role.thinkingLevel]}（当前不可用）`,
      disabled: true,
    });
  return {
    changeName,
    changeDescription,
    changeInstructions,
    changeEnabled,
    changeAccess,
    changeModel,
    changeThinking,
    modelValue,
    thinkingValue: role.thinkingLevel ?? 'inherit',
    modelOptions,
    thinkingOptions,
    accessOptions: ACCESS_OPTIONS,
  };
};
