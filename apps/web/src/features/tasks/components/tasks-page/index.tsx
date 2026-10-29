import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { TaskRow } from '@/features/tasks/components/task-row';
import { useTaskBoard } from '@/features/tasks/hooks/use-task-board';
import { describeError } from '@/utils/describe-error';

/** The task board shows persisted execution states without editable fake progress cards. */
export const TasksPage: FC = () => {
  const state = useTaskBoard();
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-6 py-5" aria-label="任务看板">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">任务看板</h1>
          <p className="text-xs text-muted-foreground">查看委派任务的进度、结果和待处理事项。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectField
            id="task-board-workspace"
            ariaLabel="筛选任务工作区"
            value={state.workspaceId ?? 'all'}
            options={state.workspaceOptions}
            onValueChange={state.changeWorkspace}
            className="h-8 w-40 text-xs"
          />
          <SelectField
            id="task-board-status"
            ariaLabel="筛选任务状态"
            value={state.filter}
            options={state.filterOptions}
            onValueChange={state.changeFilter}
            className="h-8 w-36 text-xs"
          />
        </div>
      </div>
      {state.query.isPending && (
        <p className="text-sm text-muted-foreground" role="status">
          正在读取任务…
        </p>
      )}
      {state.query.isError && <Notice tone="error">{describeError(state.query.error)}</Notice>}
      {state.query.data && state.tasks.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">当前筛选下没有任务。</p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {state.columns.map((column) => {
          return (
            <section
              key={column.id}
              className="min-w-0 rounded-2xl bg-muted/30 p-3"
              aria-label={column.title}
            >
              <h2 className="mb-2 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
                {column.title}
                <span>{column.tasks.length}</span>
              </h2>
              {column.tasks.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">暂无任务</p>
              )}
              <div className="space-y-1">
                {column.tasks.map((task) => {
                  return <TaskRow key={task.id} task={task} />;
                })}
              </div>
            </section>
          );
        })}
      </div>
      {(state.cursor > 0 ||
        (state.query.data?.nextCursor !== null && state.query.data?.nextCursor !== undefined)) && (
        <div className="flex justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={state.previous}
            disabled={state.cursor === 0}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={state.next}
            disabled={state.query.data?.nextCursor === null}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
};
