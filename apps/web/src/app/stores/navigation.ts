import { create } from 'zustand';
import type { WorkspacePage } from '@/app/types/application';

interface NavigationState {
  page: WorkspacePage;
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  navigate: (page: WorkspacePage) => void;
  selectSession: (sessionId: string) => void;
  selectWorkspace: (workspaceId: string | null) => void;
  showNewConversation: () => void;
  reset: () => void;
}

/** Owns the visible application page and active selections; it never changes draft state. */
export const useNavigationStore = create<NavigationState>((set) => {
  return {
    page: 'sessions',
    activeSessionId: null,
    activeWorkspaceId: null,
    navigate: (page: WorkspacePage): void => {
      set({ page });
    },
    selectSession: (sessionId: string): void => {
      set({ activeSessionId: sessionId, page: 'sessions' });
    },
    selectWorkspace: (workspaceId: string | null): void => {
      set({ activeWorkspaceId: workspaceId });
    },
    showNewConversation: (): void => {
      set({ activeSessionId: null, page: 'sessions' });
    },
    reset: (): void => {
      set({ page: 'sessions', activeSessionId: null, activeWorkspaceId: null });
    },
  };
});
