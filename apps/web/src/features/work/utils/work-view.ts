import type {
  Checkpoint,
  ContextUsage,
  Plan,
  Todo,
  WorkSnapshot,
  WorkState,
} from '@my-pi-harness/protocol';
import type { SelectOption } from '@/components/ui/select-field';

export const WORK_MODE_OPTIONS: SelectOption[] = [
  { value: 'execute', label: '执行' },
  { value: 'plan', label: 'Plan · 只规划' },
];
export const TODO_STATUS_OPTIONS: SelectOption[] = [
  { value: 'pending', label: '待处理' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
];
export const PLAN_STATUS_LABELS = {
  draft: '待确认',
  approved: '已批准',
  completed: '已完成',
} as const;
export const QUESTION_STATUS_LABELS = {
  pending: '等待回答',
  answered: '已回答',
  cancelled: '已取消',
  interrupted: '服务中断',
} as const;
/** Presents estimates explicitly rather than implying provider billing precision. */
export const usageLabel = (usage: ContextUsage | null): string => {
  if (!usage) {
    return '上下文';
  }
  return `上下文 ${Math.round((usage.estimatedTokens / usage.windowTokens) * 100)}%`;
};
export const formatCount = (value: number): string => {
  return new Intl.NumberFormat('zh-CN').format(value);
};
export const checkpointOptions = (checkpoints: Checkpoint[]): SelectOption[] => {
  return [
    { value: 'current', label: '当前工作状态' },
    ...checkpoints.map((entry) => {
      return { value: entry.id, label: entry.label };
    }),
  ];
};
export interface WorkDifference {
  label: string;
  left: string;
  right: string;
  changed: boolean;
}
interface ComparisonState {
  state: WorkState;
  messageIds: string[];
}
const formatPlan = (plan: Plan | null): string => {
  if (!plan) {
    return '暂无计划';
  }
  return `${plan.title} · ${PLAN_STATUS_LABELS[plan.status]}\n${plan.content}`;
};
const formatTodos = (todos: Todo[]): string => {
  return todos
    .map((todo): string => {
      const status = TODO_STATUS_OPTIONS.find((option) => {
        return option.value === todo.status;
      });
      return `${status?.label ?? todo.status} · ${todo.title}`;
    })
    .join('\n');
};
const contextStart = (entry: ComparisonState): string => {
  const marker = entry.state.contextStartAfterMessageId;
  if (marker === null) {
    return '全部历史';
  }
  const index = entry.messageIds.indexOf(marker);
  return `从第 ${index + 1} 条历史消息之后开始`;
};
const modeLabel = (state: WorkState): string => {
  if (state.mode === 'plan') {
    return 'Plan · 只规划';
  }
  return '执行';
};
/** Compares persisted values and presents user-facing plan/task text rather than raw DTO fields. */
export const compareWork = (left: ComparisonState, right: ComparisonState): WorkDifference[] => {
  const samePrefix = left.messageIds.join('\n') === right.messageIds.join('\n');
  const rows: [string, string, string][] = [
    ['模式', modeLabel(left.state), modeLabel(right.state)],
    [
      '规则',
      left.state.rules
        .map((entry) => {
          return `${entry.path}\n${entry.hash}`;
        })
        .join('\n'),
      right.state.rules
        .map((entry) => {
          return `${entry.path}\n${entry.hash}`;
        })
        .join('\n'),
    ],
    ['摘要', left.state.compaction?.summary ?? '', right.state.compaction?.summary ?? ''],
    ['上下文起点', contextStart(left), contextStart(right)],
    ['计划', formatPlan(left.state.plan), formatPlan(right.state.plan)],
    ['任务', formatTodos(left.state.todos), formatTodos(right.state.todos)],
  ];
  return [
    {
      label: '历史消息',
      left: `${left.messageIds.length} 条历史消息`,
      right: `${right.messageIds.length} 条历史消息`,
      changed: !samePrefix,
    },
    ...rows.map(([label, leftValue, rightValue]) => {
      return {
        label,
        left: leftValue || '—',
        right: rightValue || '—',
        changed: leftValue !== rightValue,
      };
    }),
  ];
};

/** Older refetches cannot replace a newer committed work revision for the same branch. */
export const retainWorkSnapshot = (previous: unknown, next: unknown): WorkSnapshot => {
  const candidate = next as WorkSnapshot;
  const current = previous as WorkSnapshot | undefined;
  if (
    current &&
    current.state.branchId === candidate.state.branchId &&
    current.state.revision > candidate.state.revision
  ) {
    return current;
  }
  if (
    current &&
    current.state.branchId === candidate.state.branchId &&
    current.state.revision === candidate.state.revision &&
    current.checkpoints.length > candidate.checkpoints.length
  ) {
    return current;
  }
  return candidate;
};
