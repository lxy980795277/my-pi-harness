import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { BarChart3, ChevronLeft, ChevronRight, GitBranch, RefreshCw } from 'lucide-react';
import type { FC, MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { SelectContent } from '@/components/ui/select/select-content';
import { SelectItem } from '@/components/ui/select/select-item';
import { SelectTrigger } from '@/components/ui/select/select-trigger';
import { SelectValue } from '@/components/ui/select/select-value';
import { TraceContent } from '@/features/trace/components/trace-content';
import { TraceList } from '@/features/trace/components/trace-list';
import { RenderDiagnostic } from '@/features/trace/components/render-diagnostic';
import { UsagePanel } from '@/features/usage/components/usage-panel';
import { useTraceDialog } from '@/features/trace/hooks/use-trace-dialog';
import {
  TRACE_KIND_OPTIONS,
  TRACE_STATUS_OPTIONS,
  traceTaskIndent,
  traceTime,
} from '@/features/trace/utils/trace-view';
import { cn } from '@/utils/cn';
import { describeError } from '@/utils/describe-error';

interface TraceDialogProps {
  snapshot: SessionSnapshot;
}

/** Read-only trace navigation preserves live execution and the conversation's scroll position. */
export const TraceDialog: FC<TraceDialogProps> = ({ snapshot }) => {
  const state = useTraceDialog(snapshot);
  const selectTask = (event: MouseEvent<HTMLButtonElement>): void => {
    state.changeTask(event.currentTarget.value);
  };
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent
        className="top-3 right-3 left-3 flex h-[calc(100svh-24px)] max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0"
        closeLabel="关闭执行轨迹"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4 pr-14">
          <div className="min-w-0 space-y-1">
            <DialogTitle>执行轨迹</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {snapshot.session.title}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={state.toggleUsage}
              aria-pressed={state.showUsage}
            >
              <BarChart3 width={14} height={14} aria-hidden />
              {!state.showUsage && '用量'}
              {state.showUsage && '返回轨迹'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={state.refresh}
            >
              <RefreshCw width={14} height={14} aria-hidden /> 刷新
            </Button>
          </div>
        </header>
        {state.showUsage && (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mx-auto w-full max-w-3xl">
              <UsagePanel
                key={state.usageScopeKey}
                sessionId={snapshot.session.id}
                scope={state.usageScope}
                running={state.running}
                title={state.usageTitle}
              />
            </div>
          </div>
        )}
        {!state.showUsage && (
          <div className="flex min-h-0 flex-1">
            <aside
              className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3 xl:flex"
              aria-label="任务范围"
            >
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'h-auto justify-start px-3 py-2 text-xs',
                  !state.filters.taskId && !state.filters.runId && 'bg-muted',
                )}
                onClick={state.allTasks}
              >
                全部执行
              </Button>
              <h3 className="px-3 pt-4 pb-2 text-[11px] text-muted-foreground">当前分支的子任务</h3>
              {state.tasks.isPending && (
                <p className="px-3 text-xs text-muted-foreground" role="status">
                  正在读取任务…
                </p>
              )}
              {state.tasks.isError && (
                <Notice tone="error">{describeError(state.tasks.error)}</Notice>
              )}
              {state.tasks.data && state.tree.length === 0 && (
                <p className="px-3 text-xs text-muted-foreground">暂无委派任务</p>
              )}
              {state.tree.map((task) => {
                return (
                  <Button
                    key={task.id}
                    type="button"
                    value={task.id}
                    variant="ghost"
                    className={cn(
                      'h-auto justify-start gap-2 py-2 pr-3 text-left text-xs font-normal',
                      traceTaskIndent(task.depth),
                      state.filters.taskId === task.id && 'bg-muted',
                    )}
                    onClick={selectTask}
                    title={task.title}
                  >
                    <GitBranch
                      width={13}
                      height={13}
                      aria-hidden
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{task.title}</span>
                  </Button>
                );
              })}
            </aside>
            <section
              className={cn(
                'flex min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:max-w-md',
                state.selected !== undefined && 'hidden lg:flex',
              )}
              aria-label="轨迹列表"
            >
              <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border p-3">
                <Select value={state.filters.branchId ?? 'all'} onValueChange={state.changeBranch}>
                  <SelectTrigger aria-label="轨迹分支">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部分支</SelectItem>
                    {snapshot.branches.map((branch) => {
                      return (
                        <SelectItem key={branch.id} value={branch.id}>
                          分支 · {traceTime(branch.createdAt)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={state.filters.runId ?? 'all'} onValueChange={state.changeRun}>
                  <SelectTrigger aria-label="轨迹运行">
                    <SelectValue placeholder="全部执行" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部执行</SelectItem>
                    {snapshot.runs.map((run) => {
                      return (
                        <SelectItem key={run.id} value={run.id}>
                          主对话 · {traceTime(run.createdAt)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={state.filters.kind ?? 'all'} onValueChange={state.changeKind}>
                  <SelectTrigger aria-label="轨迹事件类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACE_KIND_OPTIONS.map((option) => {
                      return (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={state.filters.status ?? 'all'} onValueChange={state.changeStatus}>
                  <SelectTrigger aria-label="轨迹状态">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACE_STATUS_OPTIONS.map((option) => {
                      return (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <div className="col-span-2 xl:hidden">
                  <Select value={state.filters.taskId ?? 'all'} onValueChange={state.changeTask}>
                    <SelectTrigger aria-label="轨迹子任务">
                      <SelectValue placeholder="全部子任务" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部子任务</SelectItem>
                      {state.tree.map((task) => {
                        return (
                          <SelectItem key={task.id} value={task.id}>
                            {task.title}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {state.query.isPending && (
                <p className="p-5 text-xs text-muted-foreground" role="status">
                  正在读取执行轨迹…
                </p>
              )}
              {state.query.isError && (
                <div className="p-4">
                  <Notice tone="error">{describeError(state.query.error)}</Notice>
                </div>
              )}
              {state.query.data && state.query.data.items.length === 0 && (
                <p className="p-5 text-xs text-muted-foreground">当前范围暂无已记录事件。</p>
              )}
              {state.query.data && (
                <TraceList
                  items={state.query.data.items}
                  selectedId={state.selected?.id ?? null}
                  onSelect={state.select}
                />
              )}
              <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-3 text-[11px] text-muted-foreground">
                <span>第 {state.page} 页</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={state.previous}
                    disabled={state.page === 1 || state.query.isFetching}
                  >
                    <ChevronLeft width={13} height={13} aria-hidden /> 上一页
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={state.next}
                    disabled={state.query.data?.nextCursor == null || state.query.isFetching}
                  >
                    下一页 <ChevronRight width={13} height={13} aria-hidden />
                  </Button>
                </div>
              </footer>
            </section>
            {state.selected && (
              <TraceContent
                key={state.selected.id}
                sessionId={snapshot.session.id}
                entry={state.selected}
                onBack={state.back}
              />
            )}
            {!state.selected && (
              <div className="hidden min-w-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground lg:flex">
                选择事件，查看最终模型输入或工具执行详情。
              </div>
            )}
          </div>
        )}
        <RenderDiagnostic sessionId={snapshot.session.id} />
      </DialogContent>
    </Dialog>
  );
};
