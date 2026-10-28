import { useCallback, useId } from 'react';
import { useTimelineStore } from '@/features/sessions/stores/timeline';

interface AnswerProcessState {
  expanded: boolean;
  contentId: string;
  actionLabel: string;
  toggle: () => void;
}

/** Preserve one input's disclosure choice across virtual unmounts and session switches. */
export const useAnswerProcess = (
  sessionId: string,
  inputId: string,
  onBeforeToggle: () => void,
): AnswerProcessState => {
  const expanded = useTimelineStore((state) => {
    return state.expandedProcesses[sessionId]?.[inputId] === true;
  });
  const toggleProcess = useTimelineStore((state) => {
    return state.toggleProcess;
  });
  const contentId = useId();
  const toggle = useCallback((): void => {
    onBeforeToggle();
    toggleProcess(sessionId, inputId);
  }, [inputId, onBeforeToggle, sessionId, toggleProcess]);
  let actionLabel = '展开回答过程';
  if (expanded) actionLabel = '收起回答过程';
  return { expanded, contentId, actionLabel, toggle };
};
