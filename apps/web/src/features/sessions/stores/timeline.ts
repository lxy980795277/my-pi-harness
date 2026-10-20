import { create } from 'zustand';

interface TimelineState {
  expandedTools: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  setToolExpanded: (sessionId: string, toolId: string, expanded: boolean) => void;
  toggleTool: (sessionId: string, toolId: string) => void;
  reset: () => void;
}

/** Keeps disclosure choices across timeline unmounts; recorded tool facts remain in Query. */
export const useTimelineStore = create<TimelineState>((set) => {
  return {
    expandedTools: {},
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
    reset: (): void => {
      set({ expandedTools: {} });
    },
  };
});
