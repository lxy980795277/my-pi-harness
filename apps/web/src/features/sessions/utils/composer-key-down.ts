import type { KeyboardEvent } from 'react';
import type { ComposerCompositionState, ComposerKey } from '@/features/sessions/types/composer';

/** Preserves IME confirmation even when compositionend precedes its final Enter keydown. */
export const shouldSubmitComposerKey = (
  event: ComposerKey,
  composition: ComposerCompositionState,
): boolean => {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.altKey ||
    event.isComposing ||
    composition.active
  ) {
    return false;
  }
  if (composition.endedAt !== null) {
    const elapsed = event.timeStamp - composition.endedAt;
    // Safari can end composition before keydown; a later deliberate Enter must still send.
    if (elapsed >= 0 && elapsed < 50) {
      return false;
    }
  }
  return true;
};

/** Sends through the real button so disabled state and form submission remain authoritative. */
export const composerKeyDown = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  composition: ComposerCompositionState,
): void => {
  if (!shouldSubmitComposerKey(event.nativeEvent, composition)) {
    return;
  }
  event.preventDefault();
  event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
};
