import type {
  AgentTaskDetail,
  AgentTaskList,
  AgentTaskSummary,
  MessageView,
  ToolCallView,
} from '@my-pi-harness/protocol';
import { replaceEqualDeep } from '@tanstack/react-query';
import { isNewerSnapshot } from '@/utils/snapshot-position';
import { buildRunFailures, requestFailureText } from '@/utils/run-failure';

export interface TaskTreeItem {
  task: AgentTaskSummary;
  children: TaskTreeItem[];
}

export interface TaskBoardColumn {
  id: 'queued' | 'running' | 'waiting' | 'ended';
  title: string;
  tasks: AgentTaskSummary[];
}

export interface TaskTranscriptView {
  rows: { message: MessageView; tools: ToolCallView[]; failure: string | null }[];
  fallbacks: { id: string; runId: string | null; text: string }[];
  diagnostic: string | null;
}

const STATUS_LABELS: Record<AgentTaskSummary['status'], string> = {
  queued: '待开始',
  running: '进行中',
  waiting: '等待中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断',
};
const WAITING_LABELS = {
  model: '等待模型名额',
  children: '等待子任务',
  user: '等待回答',
  approval: '等待批准',
} as const;

/** Waiting reasons are host facts, independent of transport connectivity. */
export const taskStatusLabel = (task: AgentTaskSummary): string => {
  if (task.waiting !== null) return WAITING_LABELS[task.waiting];
  return STATUS_LABELS[task.status];
};

/** Human requests remain visible even when task transcripts are closed. */
export const taskNeedsAttention = (task: AgentTaskSummary): boolean => {
  return task.waiting === 'user' || task.waiting === 'approval';
};

/** A stop remains available until the host closes the task. */
export const taskCanStop = (task: AgentTaskSummary): boolean => {
  return (
    task.closedAt === null &&
    (task.status === 'queued' ||
      task.status === 'running' ||
      task.status === 'waiting' ||
      task.status === 'completed')
  );
};

/** Grouping uses exact host states and retains failed and interrupted outcomes in the ended column. */
export const taskBoardColumns = (tasks: readonly AgentTaskSummary[]): TaskBoardColumn[] => {
  const columns: TaskBoardColumn[] = [
    { id: 'queued', title: '待开始', tasks: [] },
    { id: 'running', title: '进行中', tasks: [] },
    { id: 'waiting', title: '待处理', tasks: [] },
    { id: 'ended', title: '已结束', tasks: [] },
  ];
  for (const task of tasks) {
    let group = 'ended';
    if (task.status === 'queued' || task.status === 'running' || task.status === 'waiting')
      group = task.status;
    const column = columns.find((entry) => {
      return entry.id === group;
    });
    column?.tasks.push(task);
  }
  return columns;
};

/** Running tasks show their start time; terminal tasks have a fixed observed duration. */
export const taskTimeLabel = (task: AgentTaskSummary): string => {
  if (task.finishedAt === null)
    return new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const seconds = Math.max(0, Math.round((task.finishedAt - task.createdAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

/** Tree order follows committed creation order and keeps orphan-free branch subsets rooted. */
export const buildTaskTree = (tasks: readonly AgentTaskSummary[]): TaskTreeItem[] => {
  const nodes = new Map<string, TaskTreeItem>();
  for (const task of tasks) nodes.set(task.id, { task, children: [] });
  const roots: TaskTreeItem[] = [];
  for (const task of tasks) {
    const node = nodes.get(task.id);
    if (node === undefined) continue;
    let parent: TaskTreeItem | undefined;
    if (task.parentTaskId !== null) parent = nodes.get(task.parentTaskId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
};

/** HTTP retries cannot replace a newer ordered task snapshot. */
export const retainTaskList = (oldData: unknown, newData: unknown): AgentTaskList => {
  const previous = oldData as AgentTaskList | undefined;
  const next = newData as AgentTaskList;
  if (previous !== undefined && previous.snapshotSeq >= next.snapshotSeq) return previous;
  return replaceEqualDeep(previous, next);
};

/** Detail cursors have separate keys; recorded facts and live text advance the same page. */
export const retainTaskDetail = (oldData: unknown, newData: unknown): AgentTaskDetail => {
  const previous = oldData as AgentTaskDetail | undefined;
  const next = newData as AgentTaskDetail;
  if (previous !== undefined && !isNewerSnapshot(next, previous)) return previous;
  return replaceEqualDeep(previous, next);
};

/** Pending tool approval forms have one location outside folded transcript details. */
export const taskTranscriptView = (detail: AgentTaskDetail): TaskTranscriptView => {
  const tools = detail.tools.filter((tool) => {
    return tool.status !== 'awaiting_approval' && tool.status !== 'reviewing';
  });
  const failures = buildRunFailures(detail.messages, detail.runs);
  const rows = detail.messages.map((message) => {
    return {
      message,
      failure: failures.messages.get(message.id) ?? null,
      tools: tools.filter((tool) => {
        return tool.afterMessageId === message.id;
      }),
    };
  });
  const fallbacks: TaskTranscriptView['fallbacks'] = [];
  if (detail.nextCursor === null) {
    for (const failure of failures.unattached) {
      if (failure.run.id === detail.task.latestRunId)
        fallbacks.push({
          id: `request-error:${failure.run.id}`,
          runId: failure.run.id,
          text: failure.text,
        });
    }
    if (
      detail.task.status === 'failed' &&
      detail.task.error !== null &&
      !detail.runs.some((run) => {
        return run.id === detail.task.latestRunId && run.status === 'failed';
      })
    )
      fallbacks.push({
        id: `task-error:${detail.task.id}`,
        runId: detail.task.latestRunId,
        text: requestFailureText(detail.task.error),
      });
  }
  let diagnostic: string | null = null;
  if (detail.task.error !== null) {
    diagnostic = requestFailureText(detail.task.error);
    if (
      rows.some((row) => {
        return row.message.runId === detail.task.latestRunId && row.failure !== null;
      }) ||
      fallbacks.some((failure) => {
        return failure.runId === detail.task.latestRunId;
      })
    )
      diagnostic = null;
  }
  return { rows, fallbacks, diagnostic };
};
