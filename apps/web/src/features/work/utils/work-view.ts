import type {
  Checkpoint,
  ContextUsage,
  MessageView,
  Plan,
  Todo,
  WorkSnapshot,
} from '@my-pi-harness/protocol';
import type { WorkDifference, ComparisonState } from '@/features/work/types/work';
import type { SelectOption } from '@/components/ui/select-field';

export const TODO_STATUS_OPTIONS: SelectOption[] = [
  { value: 'pending', label: '待处理' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'blocked', label: '受阻' },
  { value: 'cancelled', label: '已取消' },
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
    return '上下文 —';
  }
  return `上下文 ${Math.round((usage.estimatedTokens / usage.windowTokens) * 100)}%`;
};
/** Snapshot messages already follow the selected branch; queued inputs have no accepted message. */
export const countConversationTurns = (messages: readonly MessageView[]): number => {
  return messages.filter((message) => {
    return message.role === 'user';
  }).length;
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
const formatPlan = (plan: Plan | null): string => {
  if (!plan) {
    return '暂无计划';
  }
  let review = '无审核';
  if (plan.review !== null) {
    review = plan.review;
  }
  let feedback = '';
  if (plan.feedback !== null) {
    feedback = plan.feedback;
  }
  const steps = plan.steps.map((step) => {
    return `${step.status} · ${step.title}`;
  });
  return [
    `${plan.title} · ${PLAN_STATUS_LABELS[plan.status]} · ${review}`,
    plan.content,
    feedback,
    steps.join('\n'),
  ].join('\n');
};
const formatTodos = (todos: Todo[]): string => {
  return todos
    .map((todo): string => {
      const status = TODO_STATUS_OPTIONS.find((option) => {
        return option.value === todo.status;
      });
      let statusLabel: string = todo.status;
      if (status) {
        statusLabel = status.label;
      }
      let stepLabel = '独立任务';
      if (todo.planStepId !== null) {
        stepLabel = todo.planStepId;
      }
      let completionNote = '';
      if (todo.completionNote !== null) {
        completionNote = todo.completionNote;
      }
      return [
        `${statusLabel} · ${todo.title} · ${stepLabel}`,
        completionNote,
        todo.evidenceToolCallIds.join(', '),
      ].join('\n');
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
/** Compares persisted values and presents user-facing plan/task text rather than raw DTO fields. */
export const compareWork = (left: ComparisonState, right: ComparisonState): WorkDifference[] => {
  const samePrefix = left.messageIds.join('\n') === right.messageIds.join('\n');
  const rows: [string, string, string][] = [
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
    (current.checkpoints.length > candidate.checkpoints.length ||
      current.compactions.length > candidate.compactions.length)
  ) {
    return current;
  }
  return candidate;
};
