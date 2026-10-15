import { create } from 'zustand';
import type { ApprovalMode, DefaultModel, InputRequest } from '@my-pi-harness/protocol';
import type {
  NewConversationAttempt,
  NewConversationIntent,
} from '@/features/sessions/types/composer-view';

export type WorkspacePage = 'sessions' | 'runtime';
export type SettingsSection = 'general' | 'models';

interface WorkspaceState {
  page: WorkspacePage;
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  newConversationDraft: string;
  newConversationModel: DefaultModel | null;
  newConversationApproval: ApprovalMode;
  newConversationGeneration: string;
  newConversationAttempt: NewConversationAttempt | null;
  pendingInputs: Readonly<Record<string, InputRequest>>;
  drafts: Readonly<Record<string, string>>;
  activeAuthFlowId: string | null;
  authFlowVisible: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  providerDialogId: string | null;
  providerAuthFlowId: string | null;
  providerAuthStarting: boolean;
  modelsDialogId: string | null;
  navigate: (page: WorkspacePage) => void;
  selectSession: (sessionId: string) => void;
  selectWorkspace: (workspaceId: string | null) => void;
  startNewConversation: () => void;
  setNewConversationDraft: (text: string) => void;
  setNewConversationModel: (model: DefaultModel) => void;
  setNewConversationApproval: (mode: ApprovalMode) => void;
  prepareInput: (sessionId: string, input: InputRequest) => InputRequest;
  clearPendingInput: (sessionId: string, requestId: string) => void;
  confirmInput: (sessionId: string, requestId: string) => void;
  beginNewAttempt: (
    generation: string,
    intent: NewConversationIntent,
  ) => NewConversationAttempt | null;
  markNewAttemptCreated: (generation: string, sessionId: string) => void;
  markNewAttemptUnknown: (generation: string) => void;
  clearNewAttempt: (generation: string) => void;
  setDraft: (sessionId: string, text: string) => void;
  clearDraft: (sessionId: string) => void;
  clearSelection: () => void;
  reset: () => void;
  addAuthFlow: (id: string) => void;
  selectAuthFlow: (id: string) => void;
  hideAuthFlow: () => void;
  openSettings: (section: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  openProvider: (id: string) => void;
  closeProvider: () => void;
  setProviderAuthFlow: (id: string | null) => void;
  setProviderAuthStarting: (starting: boolean) => void;
  openModels: (id: string) => void;
  closeModels: () => void;
}

/** Volatile navigation and unsubmitted drafts; durable session facts stay in Query. */
export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  return {
    page: 'sessions',
    activeSessionId: null,
    activeWorkspaceId: null,
    newConversationDraft: '',
    newConversationModel: null,
    newConversationApproval: 'ask',
    newConversationGeneration: crypto.randomUUID(),
    newConversationAttempt: null,
    pendingInputs: {},
    drafts: {},
    activeAuthFlowId: null,
    authFlowVisible: false,
    settingsOpen: false,
    settingsSection: 'models',
    providerDialogId: null,
    providerAuthFlowId: null,
    providerAuthStarting: false,
    modelsDialogId: null,
    navigate: (page: WorkspacePage): void => {
      set({ page });
    },
    selectSession: (sessionId: string): void => {
      set({ activeSessionId: sessionId, page: 'sessions' });
    },
    selectWorkspace: (workspaceId: string | null): void => {
      set({ activeWorkspaceId: workspaceId });
    },
    startNewConversation: (): void => {
      set({
        activeSessionId: null,
        page: 'sessions',
        newConversationGeneration: crypto.randomUUID(),
        newConversationAttempt: null,
        newConversationDraft: '',
      });
    },
    setNewConversationDraft: (text: string): void => {
      set({ newConversationDraft: text });
    },
    setNewConversationModel: (model: DefaultModel): void => {
      set({ newConversationModel: model });
    },
    setNewConversationApproval: (mode: ApprovalMode): void => {
      set({ newConversationApproval: mode });
    },
    prepareInput: (sessionId: string, input: InputRequest): InputRequest => {
      const state = get();
      const existing = state.pendingInputs[sessionId];
      if (existing) {
        return existing;
      }
      set({ pendingInputs: { ...state.pendingInputs, [sessionId]: input } });
      return input;
    },
    clearPendingInput: (sessionId: string, requestId: string): void => {
      const state = get();
      if (state.pendingInputs[sessionId]?.requestId !== requestId) {
        return;
      }
      const pendingInputs = { ...state.pendingInputs };
      delete pendingInputs[sessionId];
      set({ pendingInputs });
    },
    confirmInput: (sessionId: string, requestId: string): void => {
      const state = get();
      if (state.pendingInputs[sessionId]?.requestId !== requestId) {
        return;
      }
      const pendingInputs = { ...state.pendingInputs };
      const drafts = { ...state.drafts };
      delete pendingInputs[sessionId];
      delete drafts[sessionId];
      const attempt = state.newConversationAttempt;
      if (
        attempt?.phase === 'created' &&
        attempt.sessionId === sessionId &&
        attempt.input.requestId === requestId
      ) {
        set({ pendingInputs, drafts, newConversationAttempt: null, newConversationDraft: '' });
        return;
      }
      set({ pendingInputs, drafts });
    },
    beginNewAttempt: (
      generation: string,
      intent: NewConversationIntent,
    ): NewConversationAttempt | null => {
      const state = get();
      if (state.newConversationGeneration !== generation) {
        return null;
      }
      if (state.newConversationAttempt) {
        return state.newConversationAttempt;
      }
      const attempt: NewConversationAttempt = {
        ...intent,
        generation,
        phase: 'creating',
        sessionId: null,
      };
      set({ newConversationAttempt: attempt });
      return attempt;
    },
    markNewAttemptCreated: (generation: string, sessionId: string): void => {
      const state = get();
      const attempt = state.newConversationAttempt;
      if (!attempt || attempt.generation !== generation) {
        return;
      }
      set({
        newConversationAttempt: { ...attempt, phase: 'created', sessionId },
        pendingInputs: { ...state.pendingInputs, [sessionId]: attempt.input },
        drafts: { ...state.drafts, [sessionId]: attempt.input.text },
      });
    },
    markNewAttemptUnknown: (generation: string): void => {
      const state = get();
      const attempt = state.newConversationAttempt;
      if (attempt?.generation === generation && attempt.phase === 'creating') {
        set({ newConversationAttempt: { ...attempt, phase: 'unknown' } });
      }
    },
    clearNewAttempt: (generation: string): void => {
      const state = get();
      if (state.newConversationAttempt?.generation === generation) {
        set({ newConversationAttempt: null });
      }
    },
    setDraft: (sessionId: string, text: string): void => {
      set((state): Partial<WorkspaceState> => {
        return { drafts: { ...state.drafts, [sessionId]: text } };
      });
    },
    clearDraft: (sessionId: string): void => {
      set((state): Partial<WorkspaceState> => {
        const drafts = { ...state.drafts };
        delete drafts[sessionId];
        return { drafts };
      });
    },
    clearSelection: (): void => {
      set({ activeSessionId: null });
    },
    reset: (): void => {
      set({
        page: 'sessions',
        activeSessionId: null,
        activeWorkspaceId: null,
        newConversationDraft: '',
        newConversationModel: null,
        newConversationApproval: 'ask',
        newConversationGeneration: crypto.randomUUID(),
        newConversationAttempt: null,
        pendingInputs: {},
        drafts: {},
        activeAuthFlowId: null,
        authFlowVisible: false,
        settingsOpen: false,
        providerDialogId: null,
        providerAuthFlowId: null,
        providerAuthStarting: false,
        modelsDialogId: null,
      });
    },
    addAuthFlow: (id: string): void => {
      set({ activeAuthFlowId: id, authFlowVisible: true });
    },
    selectAuthFlow: (id: string): void => {
      set({ activeAuthFlowId: id, authFlowVisible: true });
    },
    hideAuthFlow: (): void => {
      set({ authFlowVisible: false });
    },
    openSettings: (section: SettingsSection): void => {
      set({ settingsOpen: true, settingsSection: section });
    },
    closeSettings: (): void => {
      set({
        settingsOpen: false,
        providerDialogId: null,
        providerAuthFlowId: null,
        providerAuthStarting: false,
        modelsDialogId: null,
      });
    },
    setSettingsSection: (section: SettingsSection): void => {
      set({ settingsSection: section });
    },
    openProvider: (id: string): void => {
      set({ providerDialogId: id, providerAuthFlowId: null });
    },
    closeProvider: (): void => {
      set({ providerDialogId: null, providerAuthFlowId: null });
    },
    setProviderAuthStarting: (providerAuthStarting: boolean): void => {
      set({ providerAuthStarting });
    },
    setProviderAuthFlow: (id: string | null): void => {
      set({ providerAuthFlowId: id });
    },
    openModels: (id: string): void => {
      set({ modelsDialogId: id });
    },
    closeModels: (): void => {
      set({ modelsDialogId: null });
    },
  };
});
