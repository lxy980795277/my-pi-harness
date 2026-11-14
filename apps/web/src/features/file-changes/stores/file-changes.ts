import type { FileChangeBatchInput, FileChangesQuery } from '@my-pi-harness/protocol';
import { create } from 'zustand';

export type FileChangeScope = Pick<FileChangesQuery, 'toolCallId' | 'inputMessageId'>;

interface FileChangePresentation {
  sessionId: string | null;
  scope: FileChangeScope;
  positions: (number | undefined)[];
  changeId: string | null;
  selectedIds: string[];
  showHistory: boolean;
  operationIds: Record<string, string>;
  unconfirmed: Record<string, FileChangeBatchInput>;
  open: (sessionId: string, scope: FileChangeScope) => void;
  close: (sessionId?: string) => void;
  select: (changeId: string | null) => void;
  toggle: (changeId: string) => void;
  next: (cursor: number) => void;
  previous: () => void;
  first: () => void;
  history: (show: boolean) => void;
  inspect: (sessionId: string, operationId: string) => void;
  begin: (sessionId: string, input: FileChangeBatchInput) => void;
  acknowledge: (sessionId: string, operationId: string) => void;
  stopTracking: (sessionId: string, operationId: string) => void;
  reset: () => void;
}

/** Only navigation, selections and unconfirmed user intent survive a dialog close. */
export const useFileChangesStore = create<FileChangePresentation>((set, get) => {
  return {
    sessionId: null,
    scope: {},
    positions: [undefined],
    changeId: null,
    selectedIds: [],
    showHistory: false,
    operationIds: {},
    unconfirmed: {},
    open: (sessionId, scope): void => {
      set({
        sessionId,
        scope,
        positions: [undefined],
        changeId: null,
        selectedIds: [],
        showHistory: false,
      });
    },
    close: (sessionId): void => {
      const current = get();
      if (sessionId !== undefined && current.sessionId !== sessionId) return;
      set({
        sessionId: null,
        scope: {},
        positions: [undefined],
        changeId: null,
        selectedIds: [],
        showHistory: false,
      });
    },
    select: (changeId): void => {
      set({ changeId });
    },
    toggle: (changeId): void => {
      const current = get();
      if (current.selectedIds.includes(changeId)) {
        set({
          selectedIds: current.selectedIds.filter((id) => {
            return id !== changeId;
          }),
        });
        return;
      }
      if (current.selectedIds.length >= 50) return;
      set({ selectedIds: [...current.selectedIds, changeId] });
    },
    next: (cursor): void => {
      const current = get();
      set({ positions: [...current.positions, cursor], changeId: null });
    },
    previous: (): void => {
      const current = get();
      if (current.positions.length > 1)
        set({ positions: current.positions.slice(0, -1), changeId: null });
    },
    first: (): void => {
      set({ positions: [undefined] });
    },
    history: (showHistory): void => {
      set({ showHistory });
    },
    inspect: (sessionId, operationId): void => {
      const current = get();
      set({ operationIds: { ...current.operationIds, [sessionId]: operationId } });
    },
    begin: (sessionId, input): void => {
      const current = get();
      if (current.unconfirmed[sessionId] !== undefined) return;
      set({
        unconfirmed: { ...current.unconfirmed, [sessionId]: input },
        operationIds: { ...current.operationIds, [sessionId]: input.operationId },
      });
    },
    acknowledge: (sessionId, operationId): void => {
      const current = get();
      if (current.unconfirmed[sessionId]?.operationId !== operationId) return;
      const unconfirmed = { ...current.unconfirmed };
      delete unconfirmed[sessionId];
      set({ unconfirmed });
    },
    stopTracking: (sessionId, operationId): void => {
      const current = get();
      const unconfirmed = { ...current.unconfirmed };
      const operationIds = { ...current.operationIds };
      if (unconfirmed[sessionId]?.operationId === operationId) delete unconfirmed[sessionId];
      if (operationIds[sessionId] === operationId) delete operationIds[sessionId];
      set({ unconfirmed, operationIds });
    },
    reset: (): void => {
      set({
        sessionId: null,
        scope: {},
        positions: [undefined],
        changeId: null,
        selectedIds: [],
        showHistory: false,
        operationIds: {},
        unconfirmed: {},
      });
    },
  };
});
