import type { SessionArchiveJob } from '@my-pi-harness/protocol';
import { RefreshCw, Square } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import {
  archiveBytes,
  archiveCanCancel,
  archivePhaseLabel,
} from '@/features/archives/utils/archive-view';

interface ArchiveJobStatusProps {
  job: SessionArchiveJob;
  pending: boolean;
  onCancel: () => void;
  onRefresh: () => void;
}

/** Transfer progress is host-observed; publishing cannot be represented as reversible upload work. */
export const ArchiveJobStatus: FC<ArchiveJobStatusProps> = ({
  job,
  pending,
  onCancel,
  onRefresh,
}) => {
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-label="归档操作状态">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-medium" role="status">
          {archivePhaseLabel(job)}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onRefresh}
        >
          <RefreshCw width={13} height={13} aria-hidden />
          查询
        </Button>
        {archiveCanCancel(job) && (
          <Button
            type="button"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onCancel}
            disabled={pending}
          >
            <Square width={12} height={12} aria-hidden />
            取消并清理
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        已处理 {archiveBytes(job.bytesProcessed)}
        {job.totalBytes !== null && <span> / {archiveBytes(job.totalBytes)}</span>}
      </p>
      <p className="font-mono text-[11px] break-all text-muted-foreground">
        操作 ID · {job.operationId}
      </p>
      {job.error !== null && <Notice tone="error">{job.error}</Notice>}
      {job.status === 'publishing' && (
        <p className="text-xs text-muted-foreground">
          已开始发布，不能取消；关闭后可在操作历史按此 ID 查询结果。
        </p>
      )}
    </section>
  );
};
