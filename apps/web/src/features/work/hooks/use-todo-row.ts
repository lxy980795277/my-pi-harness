import type { TodoRowState } from '@/features/work/types/work';
import type { Todo } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Commits a single changed item against the latest rendered revision. */
export const useTodoRow = (
  todo: Todo,
  onSave: (todo: Todo) => Promise<void>,
  onRemove: (id: string) => Promise<void>,
): TodoRowState => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, next: Todo | null): Promise<void> => {
        if (next) {
          await onSave(next);
        } else {
          await onRemove(todo.id);
        }
        setEditing(false);
      },
      [onRemove, onSave, todo.id],
    ),
  );
  const { run } = action;
  const start = useCallback((): void => {
    setTitle(todo.title);
    setEditing(true);
  }, [todo.title]);
  const cancel = useCallback((): void => {
    setEditing(false);
  }, []);
  const change = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
  }, []);
  const save = useCallback((): void => {
    if (title.trim()) {
      run({ ...todo, title: title.trim() });
    }
  }, [run, title, todo]);
  const remove = useCallback((): void => {
    run(null);
  }, [run]);
  const status = useCallback(
    (value: string): void => {
      if (
        value === 'pending' ||
        value === 'in_progress' ||
        value === 'completed' ||
        value === 'blocked' ||
        value === 'cancelled'
      ) {
        let completionNote = todo.completionNote;
        if (value === 'completed' && !completionNote) {
          completionNote = '用户确认完成';
        }
        run({ ...todo, status: value, completionNote });
      }
    },
    [run, todo],
  );
  return { editing, title, start, cancel, change, save, remove, status, action };
};
