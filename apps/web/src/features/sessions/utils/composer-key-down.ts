import type { KeyboardEvent } from 'react';

/** Enter follows the send button's disabled state; Shift/Alt and IME confirmation preserve input. */
export const composerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.altKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  ) {
    return;
  }
  event.preventDefault();
  event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
};
