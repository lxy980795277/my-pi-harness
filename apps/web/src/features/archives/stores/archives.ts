import { create } from 'zustand';

type ArchiveDialogMode = 'import' | 'export' | 'bind' | 'history';

interface ArchivePresentation {
  mode: ArchiveDialogMode | null;
  sessionId: string | null;
  operationId: string | null;
  lastOperations: Record<string, string>;
  commitIntents: Record<string, string>;
  openImport: () => void;
  openExport: (sessionId: string) => void;
  openBinding: (sessionId: string) => void;
  history: () => void;
  select: (operationId: string) => void;
  track: (kind: 'import' | 'export', sessionId: string | null, operationId: string) => void;
  startNew: () => void;
  rememberCommit: (operationId: string, archiveSha256: string) => void;
  confirmCommit: (operationId: string) => void;
  close: () => void;
  reset: () => void;
}

/** Stores presentation and operation identities only; manifests, jobs and file bytes remain elsewhere. */
export const useArchiveStore = create<ArchivePresentation>((set, get) => {
  return {
    mode: null,
    sessionId: null,
    operationId: null,
    lastOperations: {},
    commitIntents: {},
    openImport: (): void => {
      const current = get();
      set({
        mode: 'import',
        sessionId: null,
        operationId: current.lastOperations['import'] ?? null,
      });
    },
    openExport: (sessionId): void => {
      const current = get();
      set({
        mode: 'export',
        sessionId,
        operationId: current.lastOperations['export:' + sessionId] ?? null,
      });
    },
    openBinding: (sessionId): void => {
      set({ mode: 'bind', sessionId, operationId: null });
    },
    history: (): void => {
      set({ mode: 'history', sessionId: null, operationId: null });
    },
    select: (operationId): void => {
      set({ mode: 'history', operationId });
    },
    track: (kind, sessionId, operationId): void => {
      const current = get();
      let key: string = kind;
      if (kind === 'export') key = 'export:' + sessionId;
      set({ operationId, lastOperations: { ...current.lastOperations, [key]: operationId } });
    },
    startNew: (): void => {
      set({ operationId: null });
    },
    rememberCommit: (operationId, archiveSha256): void => {
      const current = get();
      set({ commitIntents: { ...current.commitIntents, [operationId]: archiveSha256 } });
    },
    confirmCommit: (operationId): void => {
      const current = get();
      const commitIntents = { ...current.commitIntents };
      delete commitIntents[operationId];
      set({ commitIntents });
    },
    close: (): void => {
      set({ mode: null, sessionId: null, operationId: null });
    },
    reset: (): void => {
      set({
        mode: null,
        sessionId: null,
        operationId: null,
        lastOperations: {},
        commitIntents: {},
      });
    },
  };
});
