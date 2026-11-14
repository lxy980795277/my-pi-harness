import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import type { FC, MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useFileChangeHistory } from '@/features/file-changes/hooks/use-file-change-history';
import { batchStatusLabel } from '@/features/file-changes/utils/file-change-view';
import { cn } from '@/utils/cn';
import { describeError } from '@/utils/describe-error';

interface FileChangeHistoryProps {
  sessionId: string;
  selectedId: string | undefined;
}

/** Operation history remains discoverable even when every selected file conflicted. */
export const FileChangeHistory: FC<FileChangeHistoryProps> = ({ sessionId, selectedId }) => {
  const state = useFileChangeHistory(sessionId);
  const select = (event: MouseEvent<HTMLButtonElement>): void => {
    state.select(event.currentTarget.value);
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="文件操作历史">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {state.query.isPending && (
          <p className="text-xs text-muted-foreground" role="status">
            正在读取操作历史…
          </p>
        )}
        {state.query.isError && <Notice tone="error">{describeError(state.query.error)}</Notice>}
        {state.query.data?.items.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无撤销或重做操作。</p>
        )}
        {state.query.data?.items.map((item) => {
          return (
            <Button
              key={item.operationId}
              type="button"
              variant="ghost"
              value={item.operationId}
              onClick={select}
              aria-pressed={selectedId === item.operationId}
              className={cn(
                'h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left font-normal',
                selectedId === item.operationId && 'bg-muted',
              )}
            >
              <History
                width={15}
                height={15}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block truncate text-xs">{item.operationId}</span>
                <span className="block text-[11px] text-muted-foreground">
                  共 {item.itemCount} 项 · 已执行 {item.appliedCount} · 未完成 {item.failedCount} ·
                  未知 {item.unknownCount}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.action === 'undo' && '撤销 · '}
                {item.action === 'redo' && '重做 · '}
                {batchStatusLabel(item.status)}
              </span>
            </Button>
          );
        })}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
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
