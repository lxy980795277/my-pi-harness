import type {
  FileChangeBatchItem,
  FileChangeBatchReceipt,
  FileChangeSummary,
  ToolCallView,
} from '@my-pi-harness/protocol';

const STATE_LABELS: Record<FileChangeSummary['state'], string> = {
  applied: '已应用',
  undone: '已撤销',
  unavailable: '不可操作',
};
const OPERATION_LABELS: Record<FileChangeBatchReceipt['status'], string> = {
  accepted: '已接收',
  running: '正在处理',
  completed: '已完成',
  partial: '部分完成',
  failed: '未完成',
  cancelled: '已取消',
  interrupted: '服务中断',
};
const ITEM_LABELS: Record<FileChangeBatchItem['status'], string> = {
  not_started: '未执行',
  running: '执行中',
  applied: '已执行',
  not_applied: '未应用',
  conflict: '冲突',
  unknown: '结果未知',
  cancelled: '已取消',
};

/** A native binding is required; a remote tool with the same name has no local undo identity. */
export const supportsFileChanges = (tool: ToolCallView): boolean => {
  return (
    tool.binding.kind === 'accepted' &&
    tool.binding.source.kind === 'workspace' &&
    (tool.name === 'write_file' || tool.name === 'edit_file')
  );
};

export const fileChangeStateLabel = (change: FileChangeSummary): string => {
  if (change.status === 'unknown') return '结果未知';
  if (change.status === 'conflict') return '冲突';
  if (change.status === 'prepared') return '等待确认';
  if (change.status === 'not_applied') return '未应用';
  return STATE_LABELS[change.state];
};

export const batchStatusLabel = (status: FileChangeBatchReceipt['status']): string => {
  return OPERATION_LABELS[status];
};

export const batchItemLabel = (status: FileChangeBatchItem['status']): string => {
  return ITEM_LABELS[status];
};

export const batchIsRunning = (receipt: Pick<FileChangeBatchReceipt, 'status'>): boolean => {
  return receipt.status === 'accepted' || receipt.status === 'running';
};

/** Delayed acceptance or cancellation responses cannot overwrite a confirmed terminal receipt. */
export const mergeFileChangeReceipt = (
  current: FileChangeBatchReceipt | undefined,
  incoming: FileChangeBatchReceipt,
): FileChangeBatchReceipt => {
  if (current === undefined) return incoming;
  if (!batchIsRunning(current)) return current;
  if (current.cancelRequested && !incoming.cancelRequested) return current;
  if (current.status === 'running' && incoming.status === 'accepted') return current;
  return incoming;
};

/** Intermediate edits can become undoable after later edits in the same selected chain are undone. */
export const fileChangeSelectable = (change: FileChangeSummary): boolean => {
  return change.local && (change.state === 'applied' || change.state === 'undone');
};

export const fileChangeSourceLabel = (change: FileChangeSummary): string => {
  if (change.taskId !== null) return '子任务 · ' + change.taskId;
  return '主对话';
};

export const fileChangeImageLabel = (image: FileChangeSummary['before']): string => {
  if (!image.exists) return '文件不存在';
  return image.bytes.toLocaleString() + ' 字节 · ' + image.sha256.slice(0, 12);
};
