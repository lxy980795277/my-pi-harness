import { create } from 'zustand';
import type { TraceQuery } from '@my-pi-harness/protocol';

export type TraceFilters = Pick<
  TraceQuery,
  'branchId' | 'runId' | 'taskId' | 'purpose' | 'status' | 'kind' | 'includeDescendants'
>;

export interface TracePosition {
  cursor: number;
  watermark?: number;
}

interface TracePresentationState {
  sessionId: string | null;
  entryId: string | null;
  filters: TraceFilters;
  positions: TracePosition[];
  open: (sessionId: string, branchId: string) => void;
  close: (sessionId?: string) => void;
  select: (entryId: string | null) => void;
  filter: (filters: TraceFilters) => void;
  next: (position: TracePosition) => void;
  previous: () => void;
  firstPage: () => void;
  reset: () => void;
}

const INITIAL_POSITION: TracePosition = { cursor: 0 };

/** Trace navigation survives virtual row unmounts; server facts remain in Query. */
export const useTraceStore = create<TracePresentationState>((set, get) => {
  return {
    sessionId: null,
    entryId: null,
    filters: {},
    positions: [INITIAL_POSITION],
    open: (sessionId, branchId): void => {
      set({ sessionId, entryId: null, filters: { branchId }, positions: [INITIAL_POSITION] });
    },
    close: (sessionId): void => {
      const current = get();
      if (sessionId !== undefined && current.sessionId !== sessionId) return;
      set({ sessionId: null, entryId: null, filters: {}, positions: [INITIAL_POSITION] });
    },
    select: (entryId): void => {
      set({ entryId });
    },
    filter: (filters): void => {
      set({ filters, entryId: null, positions: [INITIAL_POSITION] });
    },
    next: (position): void => {
      const current = get();
      set({ positions: [...current.positions, position], entryId: null });
    },
    previous: (): void => {
      const current = get();
      if (current.positions.length <= 1) return;
      set({ positions: current.positions.slice(0, -1), entryId: null });
    },
    firstPage: (): void => {
      set({ positions: [INITIAL_POSITION], entryId: null });
    },
    reset: (): void => {
      set({ sessionId: null, entryId: null, filters: {}, positions: [INITIAL_POSITION] });
    },
  };
});
