import type {
  MemoryAdoptedEntry,
  MemoryCurrentStatus,
  MemoryEntry,
  MemoryMode,
  MemoryOmission,
  MemorySelection,
  MemoryScope,
  MemorySource,
} from '@my-pi-harness/protocol';
import type { SelectOption } from '@/components/ui/select-field';

export const MEMORY_CATEGORIES: readonly SelectOption[] = [
  { value: 'preference', label: '偏好' },
  { value: 'fact', label: '事实' },
  { value: 'instruction', label: '约定' },
];
export const MEMORY_MODES: readonly SelectOption[] = [
  { value: 'fixed', label: '固定采用', description: '用于范围内的每次模型请求' },
  { value: 'relevant', label: '相关时采用', description: '经本地相关性复核后，按额度选用' },
];
export const MEMORY_MODE_FILTERS: readonly SelectOption[] = [
  { value: 'all', label: '所有方式' },
  ...MEMORY_MODES,
];
export const MEMORY_CATEGORY_FILTERS: readonly SelectOption[] = [
  { value: 'all', label: '全部类型' },
  ...MEMORY_CATEGORIES,
];
export const MEMORY_MANAGER_VIEWS: readonly SelectOption[] = [
  { value: 'entries', label: '管理记忆' },
  { value: 'profile', label: '有效记忆画像' },
];
const OMISSION_LABELS: Record<MemoryOmission['reason'], string> = {
  disabled: '当时已停用',
  'usage-disabled': '当时已关闭记忆使用',
  'below-threshold': '未达到相关性门槛',
  'no-query': '本次没有可用于匹配的问题',
  'not-retrieved': '本次未检索到',
  unverified: '未完成本地相关性复核',
  limit: '超过本次相关记忆条数上限',
  budget: '本次记忆额度不足',
  stale: '派发前记忆已变化',
};
const RETRIEVAL_LABELS: Record<MemorySelection['retrieval'], string> = {
  fixed: '固定记忆',
  lexical: '关键词匹配',
  hybrid: '混合匹配',
  disabled: '当时已关闭记忆使用',
};
const VERIFICATION_LABELS: Record<NonNullable<MemorySelection['verification']>, string> = {
  'local-model': '已完成本地相关性复核',
  unavailable: '相关性复核不可用，未核验的相关记忆未采用',
  'not-needed': '本次无需相关性复核',
};

/** Scopes use stable workspace IDs; names are display-only. */
export const memoryScopeKey = (scope: MemoryScope): string => {
  if (scope.kind === 'user') return 'user';
  return `workspace:${scope.workspaceId}`;
};

/** Only the current workspace is offered beside the user's own scope. */
export const memoryScopeOptions = (
  workspaceId: string | null,
  workspaceName: string | null,
): SelectOption[] => {
  const options = [{ value: 'user', label: '当前用户' }];
  if (workspaceId !== null) {
    options.push({
      value: memoryScopeKey({ kind: 'workspace', workspaceId }),
      label: `当前工作区 · ${workspaceName ?? workspaceId}`,
    });
  }
  return options;
};

/** Invalid selections never widen a workspace request into a user request. */
export const resolveMemoryScope = (value: string, workspaceId: string | null): MemoryScope => {
  if (value === 'user') return { kind: 'user' };
  if (workspaceId !== null && value === memoryScopeKey({ kind: 'workspace', workspaceId })) {
    return { kind: 'workspace', workspaceId };
  }
  throw new Error('记忆范围已变化，请重新选择。');
};

/** Category labels remain the same in the manager and historical adoption records. */
export const memoryCategoryLabel = (category: MemoryEntry['category']): string => {
  for (const option of MEMORY_CATEGORIES) {
    if (option.value === category) return option.label;
  }
  return category;
};

/** Profile sections derive only from enabled entries in the explicitly displayed page. */
export const memoryProfileGroups = (
  entries: readonly MemoryEntry[],
): { category: MemoryEntry['category']; label: string; entries: MemoryEntry[] }[] => {
  const categories: MemoryEntry['category'][] = ['preference', 'fact', 'instruction'];
  return categories
    .map((category) => {
      return {
        category,
        label: memoryCategoryLabel(category),
        entries: entries.filter((entry) => {
          return entry.enabled && entry.category === category;
        }),
      };
    })
    .filter((group) => {
      return group.entries.length > 0;
    });
};

/** Message provenance does not imply a manual confirmation or an automatic-learning decision. */
export const memorySourceLabel = (source: MemorySource): string => {
  if (source.kind === 'manual') return '手工保存';
  return '来自对话';
};

/** Historical snapshots without a mode predate relevant recall and therefore represent fixed adoption. */
export const memoryModeLabel = (mode: MemoryMode | undefined): string => {
  if (mode === 'relevant') return '相关时采用';
  return '固定采用';
};

/** Omission explanations describe the recorded request, not the current database. */
export const memoryOmissionLabel = (reason: MemoryOmission['reason']): string => {
  return OMISSION_LABELS[reason];
};

/** Older prepared requests did not record candidate-selection metadata. */
export const memorySelectionLabel = (selection: MemorySelection | undefined): string => {
  if (selection === undefined) return '本次未记录记忆选择过程';
  return RETRIEVAL_LABELS[selection.retrieval];
};

/** Verification reflects the historical request and never infers readiness from current resources. */
export const memoryVerificationLabel = (selection: MemorySelection | undefined): string | null => {
  if (selection === undefined) return null;
  if (selection.verification === undefined) return '本次未记录相关性复核情况';
  return VERIFICATION_LABELS[selection.verification];
};

/** Current facts annotate historical adoption without replacing the dispatched text. */
export const memoryChangeLabel = (
  adopted: MemoryAdoptedEntry,
  current: MemoryCurrentStatus | undefined,
  failed: boolean,
  allowUse: boolean | undefined,
): string => {
  if (failed) return '当前状态无法读取';
  if (current === undefined) return '正在核对当前状态…';
  if (current.revision === null) return '当前已忘记';
  const labels: string[] = [];
  if (current.revision !== adopted.revision) labels.push(`当前已修改 · 修订 ${current.revision}`);
  if (current.mode !== null && current.mode !== (adopted.mode ?? 'fixed'))
    labels.push(`当前已改为${memoryModeLabel(current.mode)}`);
  if (!current.enabled) labels.push('当前已停用');
  if (allowUse === false) labels.push('当前已关闭记忆使用');
  if (labels.length === 0) return '与当前记忆一致';
  return labels.join('；');
};
