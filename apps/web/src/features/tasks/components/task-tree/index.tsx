import type { FC } from 'react';
import { TaskRow } from '@/features/tasks/components/task-row';
import type { TaskTreeItem } from '@/features/tasks/utils/task-view';

interface TaskTreeProps {
  items: readonly TaskTreeItem[];
  selectedId: string | null;
}

/** Nested document flow expresses ancestry without manually positioned rows or heights. */
export const TaskTree: FC<TaskTreeProps> = ({ items, selectedId }) => {
  return (
    <ul className="space-y-1" aria-label="任务执行树">
      {items.map((item) => {
        return (
          <li key={item.task.id} className="min-w-0">
            <TaskRow task={item.task} selected={selectedId === item.task.id} />
            {item.children.length > 0 && (
              <div className="ml-4 border-l border-border/60 pl-2">
                <TaskTree items={item.children} selectedId={selectedId} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
