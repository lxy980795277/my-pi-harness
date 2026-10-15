import type { PlanPanelState } from '@/features/work/types/work-view';
import type { Todo, WorkPatch, WorkState } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Editors capture a revision when opened; remote updates produce conflicts rather than lost writes. */
export const usePlanPanel = (
  state: WorkState,
  onPatch: (input: WorkPatch) => Promise<void>,
): PlanPanelState => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [revision, setRevision] = useState(state.revision);
  const [newTodo, setNewTodo] = useState('');
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, patch: WorkPatch): Promise<void> => {
        await onPatch(patch);
        setEditing(false);
        setNewTodo('');
      },
      [onPatch],
    ),
  );
  const { run } = action;
  const start = useCallback((): void => {
    setTitle(state.plan?.title ?? '执行计划');
    setContent(state.plan?.content ?? '');
    setRevision(state.revision);
    setEditing(true);
  }, [state.plan, state.revision]);
  const cancel = useCallback((): void => {
    setEditing(false);
  }, []);
  const changeTitle = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
  }, []);
  const changeContent = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setContent(event.target.value);
  }, []);
  const changeTodo = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setNewTodo(event.target.value);
  }, []);
  const save = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!title.trim() || !content.trim()) {
        return;
      }
      run({
        expectedBranchId: state.branchId,
        revision,
        plan: {
          title: title.trim(),
          content: content.trim(),
          status: 'draft',
          updatedAt: Date.now(),
        },
      });
    },
    [content, revision, run, state.branchId, title],
  );
  const approve = useCallback((): void => {
    if (state.plan) {
      run({
        expectedBranchId: state.branchId,
        revision: state.revision,
        mode: 'execute',
        plan: { ...state.plan, status: 'approved', updatedAt: Date.now() },
      });
    }
  }, [run, state.branchId, state.plan, state.revision]);
  const complete = useCallback((): void => {
    if (state.plan) {
      run({
        expectedBranchId: state.branchId,
        revision: state.revision,
        plan: { ...state.plan, status: 'completed', updatedAt: Date.now() },
      });
    }
  }, [run, state.branchId, state.plan, state.revision]);
  const mode = useCallback(
    (value: string): void => {
      if (value === 'execute' || value === 'plan') {
        run({ expectedBranchId: state.branchId, revision: state.revision, mode: value });
      }
    },
    [run, state.branchId, state.revision],
  );
  const addTodo = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!newTodo.trim()) {
        return;
      }
      run({
        expectedBranchId: state.branchId,
        revision: state.revision,
        todos: [
          ...state.todos,
          { id: crypto.randomUUID(), title: newTodo.trim(), status: 'pending' },
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
        todos: state.todos.map((entry): Todo => {
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
        todos: state.todos.filter((entry): boolean => {
          return entry.id !== id;
        }),
      });
    },
    [onPatch, state.branchId, state.revision, state.todos],
  );
  return {
    editing,
    title,
    content,
    newTodo,
    start,
    cancel,
    changeTitle,
    changeContent,
    changeTodo,
    save,
    approve,
    complete,
    mode,
    addTodo,
    saveTodo,
    removeTodo,
    action,
  };
};
