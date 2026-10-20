import { useCallback } from 'react';
import { useNavigationStore } from '@/app/stores/navigation';
import { useAttachmentDrafts } from '@/features/attachments/stores/attachment-drafts';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useTimelineStore } from '@/features/sessions/stores/timeline';
import { useSettingsStore } from '@/features/settings/stores/settings';

/** Clears every private client domain when authorization ends; Query is cleared by its owner. */
export const useResetClientState = (): (() => void) => {
  const resetNavigation = useNavigationStore((state) => {
    return state.reset;
  });
  const resetComposer = useComposerStore((state) => {
    return state.reset;
  });
  const resetSettings = useSettingsStore((state) => {
    return state.reset;
  });
  const resetAttachments = useAttachmentDrafts((state) => {
    return state.reset;
  });
  const resetTimeline = useTimelineStore((state) => {
    return state.reset;
  });
  return useCallback((): void => {
    resetNavigation();
    resetComposer();
    resetSettings();
    resetAttachments();
    resetTimeline();
  }, [resetAttachments, resetComposer, resetNavigation, resetSettings, resetTimeline]);
};
