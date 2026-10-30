import type { DefaultModel, ProviderConfig } from '@my-pi-harness/protocol';
import type { SelectOption } from '@/components/ui/select-field';
import type { ModelMenuGroup, ModelMenuPresentation } from '@/features/models/types/model-menu';
import { modelSelectionKey } from '@/features/models/utils/model-options';

const THINKING_DESCRIPTIONS: Readonly<Record<string, string>> = {
  off: '关闭扩展推理',
  minimal: '以较少推理快速回复',
  low: '适合简单问题',
  medium: '平衡推理深度与响应速度',
  high: '适合复杂问题，耗时可能增加',
  xhigh: '使用更深入的推理',
  max: '使用模型支持的最高强度',
};

/** Group only usable providers while keeping an unavailable historical choice explicit. */
export const buildModelMenuGroups = (
  providers: readonly ProviderConfig[],
  selection: DefaultModel | null,
): ModelMenuGroup[] => {
  const groups: ModelMenuGroup[] = providers
    .filter((provider) => {
      return provider.enabled && provider.configured && provider.models.length > 0;
    })
    .map((provider) => {
      return {
        id: `provider:${provider.id}`,
        name: provider.name,
        builtinId: provider.builtinId,
        options: provider.models.map((model) => {
          return {
            value: modelSelectionKey(provider.id, model.id),
            label: `${provider.name} · ${model.name}`,
            name: model.name,
          };
        }),
      };
    });
  if (selection !== null) {
    const key = modelSelectionKey(selection.providerId, selection.modelId);
    const available = groups.some((group) => {
      return group.options.some((option) => {
        return option.value === key;
      });
    });
    if (!available) {
      groups.push({
        id: `unavailable:${key}`,
        name: '当前模型不可用',
        builtinId: null,
        options: [
          {
            value: key,
            name: selection.modelId,
            label: `${selection.modelId}（当前配置不可用）`,
            disabled: true,
          },
        ],
      });
    }
  }
  return groups;
};

/** Trigger text and reasoning choices come from the exact selected model and its capability list. */
export const modelMenuPresentation = (
  groups: readonly ModelMenuGroup[],
  selected: string,
  thinking: string,
  thinkingOptions: readonly SelectOption[],
): ModelMenuPresentation => {
  let label = '选择模型';
  let builtinId: string | null = null;
  for (const group of groups) {
    const option = group.options.find((entry) => {
      return entry.value === selected;
    });
    if (option !== undefined) {
      label = option.name;
      if (option.disabled) label = option.label;
      builtinId = group.builtinId;
      break;
    }
  }
  const currentThinking = thinkingOptions.find((option) => {
    return option.value === thinking;
  });
  return {
    label,
    builtinId,
    thinkingLabel: currentThinking?.label ?? '未加载',
    thinkingOptions: thinkingOptions.map((option) => {
      return { ...option, description: THINKING_DESCRIPTIONS[option.value] };
    }),
  };
};
