import { useCallback } from 'react';
import { useNavigationStore } from '@/app/stores/navigation';
import { useComposerStore } from '@/features/sessions/stores/composer';

/** Starts a fresh creation attempt while preserving the selected workspace, model and approval. */
export const useStartNewConversation = (): (() => void) => {
  const showNewConversation = useNavigationStore((state) => {
    return state.showNewConversation;
  });
  const startNewConversation = useComposerStore((state) => {
    return state.startNewConversation;
  });
  return useCallback((): void => {
    startNewConversation();
    showNewConversation();
  }, [showNewConversation, startNewConversation]);
};
