import type { AgentMessageInput } from '@my-pi-harness/protocol';
import { create } from 'zustand';

interface TaskMessageState {
  drafts: Readonly<Record<string, string>>;
  attempts: Readonly<Record<string, AgentMessageInput>>;
  setDraft: (key: string, text: string) => void;
  prepare: (key: string, input: AgentMessageInput) => AgentMessageInput;
  confirm: (key: string, requestId: string) => void;
  reject: (key: string, requestId: string) => void;
  reset: () => void;
}

/** Keeps unconfirmed user intent across detail unmounts; authorization cleanup clears it. */
export const useTaskMessageStore = create<TaskMessageState>((set, get) => {
  return {
    drafts: {},
    attempts: {},
    setDraft: (key, text): void => {
      const state = get();
      if (state.attempts[key] !== undefined) return;
      set({ drafts: { ...state.drafts, [key]: text } });
    },
    prepare: (key, input): AgentMessageInput => {
      const state = get();
      const existing = state.attempts[key];
      if (existing !== undefined) return existing;
      set({ attempts: { ...state.attempts, [key]: input } });
      return input;
    },
    confirm: (key, requestId): void => {
      const state = get();
      if (state.attempts[key]?.requestId !== requestId) return;
      const attempts = { ...state.attempts };
      const drafts = { ...state.drafts };
      delete attempts[key];
      delete drafts[key];
      set({ attempts, drafts });
    },
    reject: (key, requestId): void => {
      const state = get();
      if (state.attempts[key]?.requestId !== requestId) return;
      const attempts = { ...state.attempts };
      delete attempts[key];
      set({ attempts });
    },
    reset: (): void => {
      set({ drafts: {}, attempts: {} });
    },
  };
});

/** Separates task drafts even when session or task identifiers contain delimiters. */
export const taskMessageKey = (sessionId: string, taskId: string): string => {
  return JSON.stringify([sessionId, taskId]);
};
