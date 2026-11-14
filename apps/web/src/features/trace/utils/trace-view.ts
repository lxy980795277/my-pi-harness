import type {
  AgentTaskSummary,
  ModelRequestDetailQuery,
  ModelRequestSummary,
  TraceEntry,
} from '@my-pi-harness/protocol';
import type { TraceFilters } from '@/features/trace/stores/trace';
import { usageCost } from '@/features/usage/utils/usage-view';

export interface TraceOption {
  value: string;
  label: string;
}

export interface TraceTaskItem {
  id: string;
  title: string;
  depth: number;
}

export interface TraceFact {
  label: string;
  value: string;
}

export const TRACE_KIND_OPTIONS: TraceOption[] = [
  { value: 'all', label: '全部事件' },
  { value: 'request', label: '模型请求' },
  { value: 'tool', label: '工具调用' },
  { value: 'approval', label: '审批' },
  { value: 'compaction', label: '上下文压缩' },
];
export const TRACE_STATUS_OPTIONS: TraceOption[] = [
  { value: 'all', label: '全部状态' },
  { value: 'running', label: '模型请求进行中' },
  { value: 'executing', label: '工具执行中' },
  { value: 'reviewing', label: '审批复核中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已停止' },
  { value: 'interrupted', label: '已中断' },
  { value: 'awaiting_approval', label: '等待批准' },
  { value: 'unknown', label: '结果未知' },
  { value: 'denied', label: '已拒绝' },
];
export const TRACE_SECTION_OPTIONS: {
  value: NonNullable<ModelRequestDetailQuery['section']>;
  label: string;
}[] = [
  { value: 'system', label: '系统提示' },
  { value: 'messages', label: '消息' },
  { value: 'tools', label: '工具声明' },
];

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  prepared: '已准备',
  running: '进行中',
  executing: '执行中',
  reviewing: '复核中',
  awaiting_approval: '等待批准',
  completed: '已完成',
  complete: '已完成',
  failed: '失败',
  denied: '已拒绝',
  cancelled: '已停止',
  interrupted: '已中断',
  unknown: '结果未知',
};
const PURPOSE_LABELS: Record<ModelRequestSummary['purpose'], string> = {
  conversation: '对话请求',
  approval: '审批复核',
  compaction: '上下文压缩',
};
const TIME = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const TASK_INDENTS = ['pl-3', 'pl-5', 'pl-7', 'pl-9', 'pl-11'];

export const traceTaskIndent = (depth: number): string => {
  return TASK_INDENTS[Math.min(depth, TASK_INDENTS.length - 1)] ?? 'pl-3';
};

/** Host outcome names remain visible when a newly introduced state has no display alias. */
export const traceStatusLabel = (status: string): string => {
  return STATUS_LABELS[status] ?? status;
};

/** Missing observations stay unknown rather than being replaced by elapsed client time. */
export const traceDuration = (durationMs: number | null): string => {
  if (durationMs === null) return '未记录';
  if (durationMs < 1000) return Math.round(durationMs) + ' ms';
  if (durationMs < 60_000) return (durationMs / 1000).toFixed(1) + ' 秒';
  return (
    Math.floor(durationMs / 60_000) + ' 分 ' + Math.round((durationMs % 60_000) / 1000) + ' 秒'
  );
};

export const traceTime = (timestamp: number | null): string => {
  if (timestamp === null) return '未记录';
  return TIME.format(timestamp);
};

/** A finite tree flattening handles branch subsets without recursive rendering or arbitrary depth. */
export const traceTaskItems = (tasks: readonly AgentTaskSummary[]): TraceTaskItem[] => {
  const ids = new Set(
    tasks.map((task) => {
      return task.id;
    }),
  );
  const children = new Map<string | null, AgentTaskSummary[]>();
  for (const task of tasks) {
    let parent = task.parentTaskId;
    if (parent !== null && !ids.has(parent)) parent = null;
    const siblings = children.get(parent) ?? [];
    siblings.push(task);
    children.set(parent, siblings);
  }
  const result: TraceTaskItem[] = [];
  const visited = new Set<string>();
  const pending = (children.get(null) ?? [])
    .map((task) => {
      return { task, depth: 0 };
    })
    .reverse();
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined || visited.has(next.task.id)) continue;
    visited.add(next.task.id);
    result.push({ id: next.task.id, title: next.task.title, depth: next.depth });
    const descendants = children.get(next.task.id) ?? [];
    for (const task of [...descendants].reverse()) pending.push({ task, depth: next.depth + 1 });
  }
  return result;
};

/** Selected model inputs expose known dispatch facts without inferring network delivery. */
export const requestFacts = (summary: ModelRequestSummary): TraceFact[] => {
  const facts: TraceFact[] = [
    { label: '类型', value: PURPOSE_LABELS[summary.purpose] },
    { label: '状态', value: traceStatusLabel(summary.status) },
    { label: '模型', value: summary.modelId },
    { label: '交接时间', value: traceTime(summary.startedAt) },
    { label: '排队等待', value: traceDuration(summary.queueDurationMs) },
    { label: '首响应', value: traceDuration(summary.firstResponseMs) },
    { label: '模型耗时', value: traceDuration(summary.durationMs) },
    { label: '结束时间', value: traceTime(summary.finishedAt) },
    { label: '请求 ID', value: summary.modelRequestId },
  ];
  if (summary.taskId !== null) facts.push({ label: '子任务', value: summary.taskId });
  if (summary.inputMessageId !== null)
    facts.push({ label: '实际消费输入', value: summary.inputMessageId });
  if (summary.answerInputMessageId !== null)
    facts.push({ label: '回答归属', value: summary.answerInputMessageId });
  if (summary.responseId !== null)
    facts.push({ label: '供应商响应 ID', value: summary.responseId });
  if (summary.costEstimate !== null) {
    facts.push({ label: '模型估算', value: usageCost(summary.costEstimate.total) + ' USD' });
    facts.push({ label: '价格来源', value: 'Pi目录 · ' + summary.costEstimate.catalogVersion });
  } else {
    let costLabel = '价格未知';
    if (summary.pricingSource === 'pi-catalog') costLabel = '价格已记录，用量尚不足以估算';
    facts.push({ label: '模型估算', value: costLabel });
  }
  return facts;
};

export const entryFacts = (entry: TraceEntry): TraceFact[] => {
  const facts = [
    { label: '状态', value: traceStatusLabel(entry.status) },
    { label: '时间', value: traceTime(entry.at) },
    { label: '耗时', value: traceDuration(entry.durationMs) },
    { label: '日志序号', value: String(entry.seq) },
  ];
  if (entry.runId !== null) facts.push({ label: 'Run', value: entry.runId });
  if (entry.taskId !== null) facts.push({ label: '子任务', value: entry.taskId });
  return facts;
};

/** Controlled selects only publish values represented by the shared query union. */
export const updateTraceFilter = (
  current: TraceFilters,
  key: 'kind' | 'status' | 'branchId' | 'taskId' | 'runId',
  value: string,
): TraceFilters => {
  const next = { ...current };
  if (key === 'branchId') {
    delete next.taskId;
    delete next.runId;
    delete next.includeDescendants;
  }
  if (value === 'all') {
    delete next[key];
    if (key === 'taskId' || key === 'runId') delete next.includeDescendants;
    return next;
  }
  if (key === 'kind') {
    if (value === 'request' || value === 'tool' || value === 'approval' || value === 'compaction')
      next.kind = value;
    return next;
  }
  next[key] = value;
  if (key === 'taskId') delete next.runId;
  if (key === 'runId') delete next.taskId;
  if (key === 'taskId' || key === 'runId') next.includeDescendants = true;
  return next;
};
