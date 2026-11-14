import { Archive, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FC, MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useArchiveHistory } from '@/features/archives/hooks/use-archive-history';
import { archivePhaseLabel } from '@/features/archives/utils/archive-view';
import { describeError } from '@/utils/describe-error';

/** Imported operation summaries remain discoverable independently of current local UI state. */
export const ArchiveHistory: FC = () => {
  const state = useArchiveHistory();
  const select = (event: MouseEvent<HTMLButtonElement>): void => {
    state.select(event.currentTarget.value);
  };
  return (
    <section className="space-y-3" aria-label="归档操作历史">
      <p className="text-xs text-muted-foreground">
        已发布的导入记录可跨重启查询；导出的临时文件在服务重启后需重新生成。
      </p>
      {state.query.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取归档历史…
        </p>
      )}
      {state.query.isError && <Notice tone="error">{describeError(state.query.error)}</Notice>}
      {state.query.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无归档操作。</p>
      )}
      <div className="space-y-1">
        {state.query.data?.items.map((job) => {
          return (
            <Button
              key={job.operationId}
              value={job.operationId}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-3 text-left font-normal"
              onClick={select}
            >
              <Archive
                width={15}
                height={15}
                aria-hidden
                className="shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block truncate text-xs">{job.operationId}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {job.kind === 'import' && '导入'}
                  {job.kind === 'export' && '导出'} · {job.sessionId ?? '预检中'}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {archivePhaseLabel(job)}
              </span>
            </Button>
          );
        })}
      </div>
      <footer className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>第 {state.page} 页</span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={state.previous}
            disabled={state.page === 1 || state.query.isFetching}
          >
            <ChevronLeft width={13} height={13} aria-hidden />
            上一页
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={state.next}
            disabled={state.query.data?.nextCursor == null || state.query.isFetching}
          >
            下一页
            <ChevronRight width={13} height={13} aria-hidden />
          </Button>
        </div>
      </footer>
    </section>
  );
};
