import { ChevronLeft, ChevronRight, History, RefreshCw } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Notice } from '@/components/ui/notice';
import { FileChangeActions } from '@/features/file-changes/components/file-change-actions';
import { FileChangeDetail } from '@/features/file-changes/components/file-change-detail';
import { FileChangeHistory } from '@/features/file-changes/components/file-change-history';
import { FileChangeOperation } from '@/features/file-changes/components/file-change-operation';
import { FileChangeRow } from '@/features/file-changes/components/file-change-row';
import { useFileChangeOperation } from '@/features/file-changes/hooks/use-file-change-operation';
import { useFileChanges } from '@/features/file-changes/hooks/use-file-changes';
import { cn } from '@/utils/cn';
import { describeError } from '@/utils/describe-error';

interface FileChangeDialogProps {
  sessionId: string;
}

/** Recorded native writes are separate from checkpoints and external tool side effects. */
export const FileChangeDialog: FC<FileChangeDialogProps> = ({ sessionId }) => {
  const state = useFileChanges(sessionId);
  const operation = useFileChangeOperation(sessionId, state.query.data?.canOperate === true);
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent
        className="top-3 right-3 left-3 flex h-[calc(100svh-24px)] max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0"
        closeLabel="关闭文件变更"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4 pr-14">
          <div className="min-w-0 space-y-1">
            <DialogTitle>文件变更</DialogTitle>
            <DialogDescription className="text-xs">
              原生文件写入与编辑的快照；不包含终端命令、MCP 或办公脚本的修改。
            </DialogDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={state.toggleHistory}
              aria-pressed={state.showHistory}
            >
              <History width={14} height={14} aria-hidden />
              {state.showHistory && '返回变更'}
              {!state.showHistory && '操作历史'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={state.refresh}
            >
              <RefreshCw width={14} height={14} aria-hidden />
              <span className="max-sm:sr-only">刷新</span>
            </Button>
          </div>
        </header>
        {!state.showHistory && (
          <FileChangeActions
            scope={state.scope}
            selectedIds={state.selectedIds}
            blocked={operation.blocked || operation.pending}
            onOperate={operation.submit}
          />
        )}
        <FileChangeOperation state={operation} />
        {state.showHistory && (
          <FileChangeHistory sessionId={sessionId} selectedId={operation.operationId} />
        )}
        {!state.showHistory && (
          <div className="flex min-h-0 flex-1">
            <section
              className={cn(
                'flex min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:max-w-md',
                state.changeId !== null && 'hidden lg:flex',
              )}
              aria-label="文件变更列表"
            >
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {state.query.isPending && (
                  <p className="p-3 text-xs text-muted-foreground" role="status">
                    正在读取文件变更…
                  </p>
                )}
                {state.query.isError && (
                  <Notice tone="error">{describeError(state.query.error)}</Notice>
                )}
                {state.query.data?.items.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">
                    当前范围暂无已记录的原生文件变更。
                  </p>
                )}
                {state.query.data?.items.map((change) => {
                  return (
                    <FileChangeRow
                      key={change.changeId}
                      change={change}
                      selected={state.selectedIds.includes(change.changeId)}
                      active={state.changeId === change.changeId}
                      limitReached={state.selectedIds.length >= 50}
                      onSelect={state.select}
                      onToggle={state.toggle}
                    />
                  );
                })}
              </div>
              <footer className="flex shrink-0 items-center justify-between border-t border-border px-3 py-3 text-[11px] text-muted-foreground">
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
            {state.changeId !== null && (
              <FileChangeDetail
                key={state.changeId}
                sessionId={sessionId}
                changeId={state.changeId}
                blocked={operation.blocked || operation.pending}
                onBack={state.back}
                onOperate={operation.submit}
              />
            )}
            {state.changeId === null && (
              <div className="hidden min-w-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground lg:flex">
                选择文件，查看差异与修改前后的快照。
              </div>
            )}
          </div>
        )}
        <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          撤销按修改顺序逆序执行，重做正序执行；磁盘内容不一致时报告冲突。关闭面板不会停止已接收的操作。
        </p>
      </DialogContent>
    </Dialog>
  );
};
