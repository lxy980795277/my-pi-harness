import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Notice } from '@/components/ui/notice';
import { TaskDetail } from '@/features/tasks/components/task-detail';
import { TaskTree } from '@/features/tasks/components/task-tree';
import { useTaskDialog } from '@/features/tasks/hooks/use-task-dialog';
import { describeError } from '@/utils/describe-error';

interface TaskDialogProps {
  connected: boolean;
}

/** User-opened details leave the main conversation width and scroll position unchanged. */
export const TaskDialog: FC<TaskDialogProps> = ({ connected }) => {
  const state = useTaskDialog();
  return (
    <Dialog open={state.sessionId !== null} onOpenChange={state.changeOpen}>
      {state.sessionId !== null && (
        <DialogContent
          className="top-3 right-3 left-auto flex h-[calc(100svh-24px)] max-h-none w-[calc(100%_-_24px)] max-w-5xl translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0"
          closeLabel="关闭任务详情"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4 pr-14">
            <div className="space-y-1">
              <DialogTitle>会话任务</DialogTitle>
              <DialogDescription className="text-xs">
                选择任务查看独立上下文、执行结果和待处理事项。
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-xs"
              onClick={state.conversation}
            >
              返回对话
            </Button>
          </header>
          {!connected && (
            <p className="px-5 py-2 text-xs text-muted-foreground" role="status">
              任务事件正在连接，后台执行不受影响。
            </p>
          )}
          {state.query.isError && (
            <div className="p-5">
              <Notice tone="error">{describeError(state.query.error)}</Notice>
            </div>
          )}
          {state.query.isPending && (
            <p className="p-5 text-sm text-muted-foreground" role="status">
              正在读取任务…
            </p>
          )}
          {state.query.data && state.tree.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">当前分支还没有委派任务。</p>
          )}
          {state.tree.length > 0 && (
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[260px_minmax(0,1fr)] sm:grid-rows-1">
              <aside
                className="max-h-40 overflow-y-auto border-b border-border p-3 sm:max-h-none sm:border-r sm:border-b-0"
                aria-label="选择任务"
              >
                <TaskTree items={state.tree} selectedId={state.selected?.id ?? null} />
              </aside>
              <div className="min-h-0 min-w-0 overflow-y-auto p-5">
                {state.selected && <TaskDetail key={state.selected.id} task={state.selected} />}
              </div>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
};
