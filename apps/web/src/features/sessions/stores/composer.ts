import { create } from 'zustand';
import type {
  ApprovalMode,
  DefaultModel,
  InputRequest,
  McpToolSelection,
  SkillSelection,
  SearchSourceSelection,
} from '@my-pi-harness/protocol';
import type {
  NewConversationAttempt,
  NewConversationIntent,
} from '@/features/sessions/types/composer';
import {
  EMPTY_SEARCH_QUOTES,
  remainingSearchQuotes,
} from '@/features/sessions/utils/search-quotes';
import { sourceSelectionKey } from '@/features/search/utils/search';

interface ComposerState {
  newConversationDraft: string;
  newConversationModel: DefaultModel | null;
  newConversationApproval: ApprovalMode;
  newConversationGeneration: string;
  newConversationAttempt: NewConversationAttempt | null;
  pendingInputs: Readonly<Record<string, InputRequest>>;
  drafts: Readonly<Record<string, string>>;
  mcpSelections: Readonly<Record<string, McpToolSelection[]>>;
  skillSelections: Readonly<Record<string, SkillSelection[]>>;
  searchQuotes: Readonly<Record<string, readonly SearchSourceSelection[]>>;
  addSearchQuote: (draftKey: string, selection: SearchSourceSelection) => void;
  removeSearchQuote: (draftKey: string, key: string) => void;
  setSkillSelections: (draftKey: string, skills: SkillSelection[]) => void;
  setMcpSelections: (draftKey: string, tools: McpToolSelection[]) => void;
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
  reset: () => void;
}

/** Owns volatile composer choices, drafts and unconfirmed submissions; server facts stay in Query. */
export const useComposerStore = create<ComposerState>((set, get) => {
  return {
    newConversationDraft: '',
    newConversationModel: null,
    newConversationApproval: 'full-access',
    newConversationGeneration: crypto.randomUUID(),
    newConversationAttempt: null,
    pendingInputs: {},
    drafts: {},
    mcpSelections: {},
    skillSelections: {},
    searchQuotes: {},
    addSearchQuote: (draftKey, selection): void => {
      const state = get();
      if (
        state.pendingInputs[draftKey] !== undefined ||
        (draftKey === `new:${state.newConversationGeneration}` &&
          state.newConversationAttempt !== null)
      )
        throw new Error('当前输入的提交结果尚未确认，请确认后再添加引用。');
      if (selection.end <= selection.start || selection.end - selection.start > 8000)
        throw new Error('每条引用须为 1–8,000 字符的明确原文范围。');
      const entries = state.searchQuotes[draftKey] ?? EMPTY_SEARCH_QUOTES;
      const key = sourceSelectionKey(selection);
      if (
        entries.some((entry) => {
          return sourceSelectionKey(entry) === key;
        })
      )
        return;
      if (entries.length >= 4) throw new Error('每次输入最多引用 4 个片段，请先移除已有引用。');
      set({ searchQuotes: { ...state.searchQuotes, [draftKey]: [...entries, selection] } });
    },
    removeSearchQuote: (draftKey, key): void => {
      set((state): Partial<ComposerState> => {
        return {
          searchQuotes: {
            ...state.searchQuotes,
            [draftKey]: (state.searchQuotes[draftKey] ?? EMPTY_SEARCH_QUOTES).filter((entry) => {
              return sourceSelectionKey(entry) !== key;
            }),
          },
        };
      });
    },
    setSkillSelections: (draftKey, skills): void => {
      set((state): Partial<ComposerState> => {
        return { skillSelections: { ...state.skillSelections, [draftKey]: skills } };
      });
    },
    setMcpSelections: (draftKey, tools): void => {
      set((state): Partial<ComposerState> => {
        return { mcpSelections: { ...state.mcpSelections, [draftKey]: tools } };
      });
    },
    startNewConversation: (): void => {
      const state = get();
      const mcpSelections = { ...state.mcpSelections };
      const skillSelections = { ...state.skillSelections };
      const searchQuotes = { ...state.searchQuotes };
      delete searchQuotes[`new:${state.newConversationGeneration}`];
      delete skillSelections[`new:${state.newConversationGeneration}`];
      delete mcpSelections[`new:${state.newConversationGeneration}`];
      set({
        mcpSelections,
        skillSelections,
        searchQuotes,
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
      const searchQuotes = { ...state.searchQuotes };
      const submitted = state.pendingInputs[sessionId]?.searchQuotes ?? EMPTY_SEARCH_QUOTES;
      const remaining = remainingSearchQuotes(
        searchQuotes[sessionId] ?? EMPTY_SEARCH_QUOTES,
        submitted,
      );
      if (remaining.length === 0) delete searchQuotes[sessionId];
      else searchQuotes[sessionId] = remaining;
      delete pendingInputs[sessionId];
      delete drafts[sessionId];
      const attempt = state.newConversationAttempt;
      if (
        attempt?.phase === 'created' &&
        attempt.sessionId === sessionId &&
        attempt.input.requestId === requestId
      ) {
        delete searchQuotes[`new:${attempt.generation}`];
        set({
          pendingInputs,
          drafts,
          searchQuotes,
          newConversationAttempt: null,
          newConversationDraft: '',
        });
        return;
      }
      set({ pendingInputs, drafts, searchQuotes });
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
        mcpSelections: { ...state.mcpSelections, [sessionId]: attempt.input.mcpTools ?? [] },
        skillSelections: { ...state.skillSelections, [sessionId]: attempt.input.skills ?? [] },
        searchQuotes: {
          ...state.searchQuotes,
          [sessionId]: attempt.input.searchQuotes ?? EMPTY_SEARCH_QUOTES,
        },
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
        newConversationApproval: 'full-access',
        newConversationGeneration: crypto.randomUUID(),
        newConversationAttempt: null,
        pendingInputs: {},
        drafts: {},
        mcpSelections: {},
        skillSelections: {},
        searchQuotes: {},
      });
    },
  };
});
