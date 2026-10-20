import { create } from 'zustand';
import type { ApprovalMode, DefaultModel, InputRequest } from '@my-pi-harness/protocol';
import type {
  NewConversationAttempt,
  NewConversationIntent,
  WorkMode,
} from '@/features/sessions/types/composer';

interface ComposerState {
  newConversationDraft: string;
  newConversationModel: DefaultModel | null;
  newConversationApproval: ApprovalMode;
  newConversationWorkMode: WorkMode;
  newConversationGeneration: string;
  newConversationAttempt: NewConversationAttempt | null;
  pendingInputs: Readonly<Record<string, InputRequest>>;
  drafts: Readonly<Record<string, string>>;
  startNewConversation: () => void;
  setNewConversationDraft: (text: string) => void;
  setNewConversationModel: (model: DefaultModel) => void;
  setNewConversationApproval: (mode: ApprovalMode) => void;
  setNewConversationWorkMode: (mode: WorkMode) => void;
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
  reset: () => void;
}

/** Owns volatile composer choices, drafts and unconfirmed submissions; server facts stay in Query. */
export const useComposerStore = create<ComposerState>((set, get) => {
  return {
    newConversationDraft: '',
    newConversationModel: null,
    newConversationApproval: 'ask',
    newConversationWorkMode: 'execute',
    newConversationGeneration: crypto.randomUUID(),
    newConversationAttempt: null,
    pendingInputs: {},
    drafts: {},
    startNewConversation: (): void => {
      set({
        newConversationGeneration: crypto.randomUUID(),
        newConversationAttempt: null,
        newConversationDraft: '',
        newConversationWorkMode: 'execute',
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
    setNewConversationWorkMode: (mode): void => {
      const state = get();
      if (!state.newConversationAttempt) {
        set({ newConversationWorkMode: mode });
      }
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
      set((state): Partial<ComposerState> => {
        return { drafts: { ...state.drafts, [sessionId]: text } };
      });
    },
    clearDraft: (sessionId: string): void => {
      set((state): Partial<ComposerState> => {
        const drafts = { ...state.drafts };
        delete drafts[sessionId];
        return { drafts };
      });
    },
    reset: (): void => {
      set({
        newConversationDraft: '',
        newConversationModel: null,
        newConversationApproval: 'ask',
        newConversationWorkMode: 'execute',
        newConversationGeneration: crypto.randomUUID(),
        newConversationAttempt: null,
        pendingInputs: {},
        drafts: {},
      });
    },
  };
});
