import { create } from 'zustand';

interface TimelineState {
  expandedTools: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  expandedProcesses: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  setToolExpanded: (sessionId: string, toolId: string, expanded: boolean) => void;
  toggleTool: (sessionId: string, toolId: string) => void;
  toggleProcess: (sessionId: string, inputId: string) => void;
  reset: () => void;
}

/** Keeps input/tool disclosure choices across unmounts; recorded facts remain in Query. */
export const useTimelineStore = create<TimelineState>((set) => {
  return {
    expandedTools: {},
    expandedProcesses: {},
    setToolExpanded: (sessionId, toolId, expanded): void => {
      set((state): Partial<TimelineState> => {
        return {
          expandedTools: {
            ...state.expandedTools,
            [sessionId]: { ...state.expandedTools[sessionId], [toolId]: expanded },
          },
        };
      });
    },
    toggleTool: (sessionId, toolId): void => {
      set((state): Partial<TimelineState> => {
        const expanded = state.expandedTools[sessionId]?.[toolId] === true;
        return {
          expandedTools: {
            ...state.expandedTools,
            [sessionId]: { ...state.expandedTools[sessionId], [toolId]: !expanded },
          },
        };
      });
    },
    toggleProcess: (sessionId, inputId): void => {
      set((state): Partial<TimelineState> => {
        const expanded = state.expandedProcesses[sessionId]?.[inputId] === true;
        return {
          expandedProcesses: {
            ...state.expandedProcesses,
            [sessionId]: { ...state.expandedProcesses[sessionId], [inputId]: !expanded },
          },
        };
      });
    },
    reset: (): void => {
      set({ expandedTools: {}, expandedProcesses: {} });
    },
  };
});
