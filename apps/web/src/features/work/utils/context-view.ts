import type {
  Compaction,
  ContextSummary,
  ContextUsage,
  Todo,
  WorkSnapshot,
} from '@my-pi-harness/protocol';
import { formatCount } from '@/features/work/utils/work-view';
import type { SummaryRow, WorkDifference } from '@/features/work/types/work';

const SUMMARY_FIELDS: { key: keyof ContextSummary; label: string }[] = [
  { key: 'objective', label: '目标' },
  { key: 'constraints', label: '约束' },
  { key: 'decisions', label: '决策' },
  { key: 'completed', label: '已完成' },
  { key: 'pending', label: '待完成' },
  { key: 'blockers', label: '阻塞' },
  { key: 'nextAction', label: '下一步' },
];
const summaryContent = (value: ContextSummary[keyof ContextSummary]): string => {
  let content = '';
  if (typeof value === 'string') {
    content = value;
  } else {
    content = value.join('\n');
  }
  return content || '—';
};
export const summaryRows = (summary: ContextSummary): SummaryRow[] => {
  return SUMMARY_FIELDS.map((field) => {
    return { label: field.label, content: summaryContent(summary[field.key]) };
  });
};

/** Comparison keeps each semantic section visible even when two versions share its text. */
export const compareSummaries = (left: Compaction, right: Compaction): WorkDifference[] => {
  return SUMMARY_FIELDS.map((field) => {
    const first = summaryContent(left.structured[field.key]);
    const second = summaryContent(right.structured[field.key]);
    return { label: field.label, left: first, right: second, changed: first !== second };
  });
};

export const compactionLabel = (value: Compaction, index: number): string => {
  let reason = '自动';
  if (value.reason === 'manual') {
    reason = '手动';
  }
  return `版本 ${index + 1} · ${reason} · ${new Date(value.createdAt).toLocaleString('zh-CN', { hour12: false })}`;
};

/** Category counts remain estimates even when total input is calibrated by provider usage. */
export const usageCategories = (usage: ContextUsage): { label: string; tokens: string }[] => {
  const labels: Record<keyof ContextUsage['categories'], string> = {
    system: '系统提示',
    rules: '项目规则',
    tools: '工具定义',
    messages: '对话与工具结果',
    attachments: '附件',
    summary: '上下文摘要',
    workingState: '计划与任务',
  };
  return Object.entries(usage.categories).map(([key, value]) => {
    return { label: labels[key as keyof typeof labels], tokens: formatCount(value) };
  });
};

/** Summarizes actual task progress without treating blocked or cancelled work as completed. */
export const todoProgress = (todos: Todo[]): string => {
  const completed = todos.filter((todo) => {
    return todo.status === 'completed';
  }).length;
  const current = todos.find((todo) => {
    return todo.status === 'in_progress';
  });
  let label = `${completed}/${todos.length} 个任务完成`;
  if (current) {
    label += ` · ${current.title}`;
  }
  return label;
};

/** Provider measurements calibrate the total; category attribution remains estimated. */
export const usageSourceLabel = (usage: ContextUsage): string => {
  if (usage.source === 'provider') {
    return '供应商用量校准';
  }
  return '本地估算';
};

/** Prefer the selected version, then the active summary, then the latest saved version. */
export const resolveCompaction = (work: WorkSnapshot, selectedId: string): Compaction | null => {
  const selected = work.compactions.find((entry) => {
    return entry.id === selectedId;
  });
  if (selected) {
    return selected;
  }
  if (work.state.compaction !== null) {
    return work.state.compaction;
  }
  const latest = work.compactions.at(-1);
  if (latest) {
    return latest;
  }
  return null;
};
