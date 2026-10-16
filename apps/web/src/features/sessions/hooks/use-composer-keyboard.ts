import { useCallback, useRef, type CompositionEvent } from 'react';
import type {
  ComposerCompositionState,
  ComposerKeyboardHandlers,
} from '@/features/sessions/types/composer';
import { composerKeyDown } from '@/features/sessions/utils/composer-key-down';

/** Owns composition state for one editor without legacy keyboard codes or global listeners. */
export const useComposerKeyboard = (): ComposerKeyboardHandlers => {
  const composition = useRef<ComposerCompositionState>({ active: false, endedAt: null });
  const keyDown = useCallback<ComposerKeyboardHandlers['keyDown']>((event): void => {
    composerKeyDown(event, composition.current);
  }, []);
  const keyUp = useCallback((): void => {
    composition.current.endedAt = null;
  }, []);
  const compositionStart = useCallback((): void => {
    composition.current = { active: true, endedAt: null };
  }, []);
  const compositionEnd = useCallback((event: CompositionEvent<HTMLTextAreaElement>): void => {
    composition.current = { active: false, endedAt: event.timeStamp };
  }, []);
  return { keyDown, keyUp, compositionStart, compositionEnd };
};
