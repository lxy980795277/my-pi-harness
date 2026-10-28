import type { PlanPanelState } from '@/features/work/types/work';
import type { Todo, WorkPatch, WorkState } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Task edits use the rendered revision; plan approval has a separate active-run endpoint. */
export const usePlanPanel = (
  state: WorkState,
  onPatch: (input: WorkPatch) => Promise<void>,
): PlanPanelState => {
  const [newTodo, setNewTodo] = useState('');
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, patch: WorkPatch): Promise<void> => {
        await onPatch(patch);
        setNewTodo('');
      },
      [onPatch],
    ),
  );
  const { run } = action;
  const changeTodo = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setNewTodo(event.target.value);
  }, []);
  const addTodo = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!newTodo.trim()) {
        return;
      }
      run({
        expectedBranchId: state.branchId,
        revision: state.revision,
        todos: [
          ...state.todos,
          {
            id: crypto.randomUUID(),
            title: newTodo.trim(),
            status: 'pending',
            planStepId: null,
            evidenceToolCallIds: [],
            completionNote: null,
          },
        ],
      });
    },
    [newTodo, run, state.branchId, state.revision, state.todos],
  );
  const saveTodo = useCallback(
    async (todo: Todo): Promise<void> => {
      await onPatch({
        expectedBranchId: state.branchId,
        revision: state.revision,
        todos: state.todos.map((entry) => {
          if (entry.id === todo.id) {
            return todo;
          }
          return entry;
        }),
      });
    },
    [onPatch, state.branchId, state.revision, state.todos],
  );
  const removeTodo = useCallback(
    async (id: string): Promise<void> => {
      await onPatch({
        expectedBranchId: state.branchId,
        revision: state.revision,
        todos: state.todos.filter((entry) => {
          return entry.id !== id;
        }),
      });
    },
    [onPatch, state.branchId, state.revision, state.todos],
  );
  return { newTodo, changeTodo, addTodo, saveTodo, removeTodo, action };
};
