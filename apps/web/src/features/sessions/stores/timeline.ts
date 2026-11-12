import { create } from 'zustand';
import type { TimelineTarget } from '@/features/sessions/types/timeline-target';

interface TimelineState {
  expandedTools: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  expandedProcesses: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  targets: Readonly<Record<string, TimelineTarget>>;
  setToolExpanded: (sessionId: string, toolId: string, expanded: boolean) => void;
  toggleTool: (sessionId: string, toolId: string) => void;
  toggleProcess: (sessionId: string, inputId: string) => void;
  setProcessExpanded: (sessionId: string, inputId: string, expanded: boolean) => void;
  locate: (sessionId: string, target: TimelineTarget) => void;
  clearTarget: (sessionId: string, id: string) => void;
  reset: () => void;
}

/** Keeps input/tool disclosure choices across unmounts; recorded facts remain in Query. */
export const useTimelineStore = create<TimelineState>((set) => {
  return {
    expandedTools: {},
    expandedProcesses: {},
    targets: {},
    locate: (sessionId, target): void => {
      set((state): Partial<TimelineState> => {
        return { targets: { ...state.targets, [sessionId]: target } };
      });
    },
    clearTarget: (sessionId, id): void => {
      set((state): Partial<TimelineState> => {
        if (state.targets[sessionId]?.id !== id) return {};
        const targets = { ...state.targets };
        delete targets[sessionId];
        return { targets };
      });
    },
    setProcessExpanded: (sessionId, inputId, expanded): void => {
      set((state): Partial<TimelineState> => {
        return {
          expandedProcesses: {
            ...state.expandedProcesses,
            [sessionId]: { ...state.expandedProcesses[sessionId], [inputId]: expanded },
          },
        };
      });
    },
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
      set({ expandedTools: {}, expandedProcesses: {}, targets: {} });
    },
  };
});
