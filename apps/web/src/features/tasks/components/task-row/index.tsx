import type { AgentTaskSummary } from '@my-pi-harness/protocol';
import { GitBranch, LoaderCircle } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { useTaskPresentationStore } from '@/features/tasks/stores/tasks';
import {
  taskCanStop,
  taskNeedsAttention,
  taskStatusLabel,
  taskTimeLabel,
} from '@/features/tasks/utils/task-view';
import { cn } from '@/utils/cn';

interface TaskRowProps {
  task: AgentTaskSummary;
  selected?: boolean;
}

/** Selection opens recorded task facts; streaming never opens or resizes the panel itself. */
export const TaskRow: FC<TaskRowProps> = ({ task, selected = false }) => {
  const open = useTaskPresentationStore((state) => {
    return state.open;
  });
  const select = (): void => {
    open(task.sessionId, task.id);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={select}
      aria-current={selected && 'true'}
      className={cn(
        'h-auto w-full min-w-0 justify-start gap-3 rounded-xl px-3 py-3 text-left font-normal',
        selected && 'bg-muted',
      )}
    >
      {!taskCanStop(task) && (
        <GitBranch width={15} height={15} className="shrink-0 text-muted-foreground" aria-hidden />
      )}
      {taskCanStop(task) && (
        <LoaderCircle
          width={15}
          height={15}
          className="shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {task.role.name} · {taskTimeLabel(task)}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-xs text-muted-foreground',
          taskNeedsAttention(task) && 'text-warning-solid',
        )}
      >
        {taskStatusLabel(task)}
      </span>
    </Button>
  );
};
