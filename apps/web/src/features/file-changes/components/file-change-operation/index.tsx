import { RefreshCw, Square } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { useFileChangeOperation } from '@/features/file-changes/hooks/use-file-change-operation';
import { batchItemLabel, batchStatusLabel } from '@/features/file-changes/utils/file-change-view';
import { describeError } from '@/utils/describe-error';

interface FileChangeOperationProps {
  state: ReturnType<typeof useFileChangeOperation>;
}

/** Durable receipts distinguish partial, conflicted and unknown writes from confirmed application. */
export const FileChangeOperation: FC<FileChangeOperationProps> = ({ state }) => {
  if (state.operationId === undefined) {
    if (state.error === null) return null;
    return (
      <div className="shrink-0 border-b border-border px-4 py-3">
        <Notice tone="error">{state.error}</Notice>
      </div>
    );
  }
  return (
    <div
      className="shrink-0 space-y-2 border-b border-border bg-muted/20 px-4 py-3 text-xs"
      aria-label="文件操作结果"
    >
      {state.unconfirmed !== undefined && (
        <Notice>
          <div className="space-y-2">
            <p>尚未确认接收。操作可能已生效，正在按原操作 ID 查询，不会自动重新提交。</p>
            <p className="font-mono text-[11px] break-all">{state.unconfirmed.operationId}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-7 text-xs"
                onClick={state.inspectUnconfirmed}
              >
                查看未确认操作
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-7 text-xs"
                onClick={state.retrySubmission}
                disabled={state.pending}
              >
                使用原 ID 重新提交
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-7 text-xs"
                onClick={state.stopTracking}
                disabled={state.pending}
              >
                停止跟踪
              </Button>
            </div>
            <p>停止跟踪不会取消服务侧操作；已接收的操作仍可从操作历史找回。</p>
          </div>
        </Notice>
      )}
      {state.error !== null && <Notice tone="error">{state.error}</Notice>}
      {state.query.isError && !state.receptionUnknown && (
        <Notice tone="error">{describeError(state.query.error)}</Notice>
      )}
      {state.receptionUnknown && state.unconfirmed === undefined && (
        <Notice>尚未确认接收，未找到此操作的持久回执；这不代表没有副作用。</Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-muted-foreground" title={state.operationId}>
          操作 · {state.operationId}
        </p>
        {state.query.data && <span role="status">{batchStatusLabel(state.query.data.status)}</span>}
        {state.query.isPending && (
          <span className="text-muted-foreground" role="status">
            正在确认操作…
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={state.refresh}
          disabled={state.query.isFetching}
        >
          <RefreshCw width={13} height={13} aria-hidden />
          查询结果
        </Button>
        {state.canCancel && (
          <Button
            type="button"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={state.cancel}
            disabled={state.pending}
          >
            <Square width={12} height={12} aria-hidden />
            取消未开始项
          </Button>
        )}
        {state.query.data?.cancelRequested === true && (
          <span className="text-muted-foreground">正在取消未开始项</span>
        )}
      </div>
      {state.query.data && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer py-1">
            查看 {state.query.data.items.length} 项执行结果
          </summary>
          <div className="max-h-48 space-y-2 overflow-y-auto pt-2">
            {state.query.data.error !== null && (
              <Notice tone="error">{state.query.data.error}</Notice>
            )}
            {state.query.data.items.map((item) => {
              return (
                <div key={item.changeId} className="space-y-1 rounded-lg bg-muted/50 px-3 py-2">
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1 break-all">{item.path}</span>
                    <span className="shrink-0">{batchItemLabel(item.status)}</span>
                  </div>
                  {item.error !== null && <p className="text-destructive">{item.error}</p>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
};
