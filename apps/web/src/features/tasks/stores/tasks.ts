import { create } from 'zustand';
import type { AgentBoardQuery } from '@my-pi-harness/protocol';

export type TaskFilter = NonNullable<AgentBoardQuery['filter']>;

interface TaskPresentationState {
  sessionId: string | null;
  taskId: string | null;
  filter: TaskFilter;
  open: (sessionId: string, taskId?: string) => void;
  close: () => void;
  setFilter: (filter: TaskFilter) => void;
  reset: () => void;
}

/** Only view selection survives component unmounts; task facts stay in Query. */
export const useTaskPresentationStore = create<TaskPresentationState>((set) => {
  return {
    sessionId: null,
    taskId: null,
    filter: 'all',
    open: (sessionId: string, taskId?: string): void => {
      set({ sessionId, taskId: taskId ?? null });
    },
    close: (): void => {
      set({ sessionId: null, taskId: null });
    },
    setFilter: (filter: TaskFilter): void => {
      set({ filter });
    },
    reset: (): void => {
      set({ sessionId: null, taskId: null, filter: 'all' });
    },
  };
});
