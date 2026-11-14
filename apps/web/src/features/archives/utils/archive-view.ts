import type { SessionArchiveJob } from '@my-pi-harness/protocol';

const PHASE_LABELS: Record<SessionArchiveJob['phase'], string> = {
  collecting: '正在收集冻结的会话与资源',
  packing: '正在打包归档',
  uploading: '正在接收归档',
  validating: '正在校验全部资源与身份',
  ready: '已完成预检',
  publishing: '正在发布导入会话',
  completed: '已完成',
  cancelled: '已取消',
  failed: '未完成',
};
const PHASE_RANK: Record<SessionArchiveJob['phase'], number> = {
  collecting: 0,
  packing: 1,
  uploading: 0,
  validating: 1,
  ready: 2,
  publishing: 3,
  completed: 4,
  cancelled: 4,
  failed: 4,
};

export const archivePhaseLabel = (job: SessionArchiveJob): string => {
  if (job.kind === 'export' && job.status === 'ready') return '归档已准备好';
  return PHASE_LABELS[job.phase];
};

export const archiveIsActive = (job: SessionArchiveJob): boolean => {
  return job.status === 'running' || job.status === 'publishing';
};

export const archiveCanCancel = (job: SessionArchiveJob): boolean => {
  return job.status === 'running' || job.status === 'ready';
};

export const archiveBytes = (bytes: number): string => {
  if (bytes < 1024) return bytes.toLocaleString() + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MiB';
};

/** A late upload/export response cannot regress publishing, a terminal result or newer progress. */
export const mergeArchiveJob = (
  current: SessionArchiveJob | undefined,
  incoming: SessionArchiveJob,
): SessionArchiveJob => {
  if (current === undefined) return incoming;
  if (current.kind === 'export' && incoming.kind === 'export') {
    const released =
      (current.status === 'completed' || current.status === 'ready') && !current.downloadAvailable;
    if (released && incoming.downloadAvailable) return current;
    if (
      current.status === 'completed' &&
      incoming.status === 'completed' &&
      !incoming.downloadAvailable
    )
      return incoming;
  }
  if (
    current.status === 'completed' ||
    current.status === 'failed' ||
    current.status === 'cancelled'
  )
    return current;
  if (PHASE_RANK[incoming.phase] < PHASE_RANK[current.phase]) return current;
  if (current.phase === incoming.phase && incoming.bytesProcessed < current.bytesProcessed)
    return current;
  return incoming;
};
