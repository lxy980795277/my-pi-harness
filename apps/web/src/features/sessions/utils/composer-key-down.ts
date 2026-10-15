import type { KeyboardEvent } from 'react';

/** Newlines remain ordinary input; the explicit command shortcut submits outside IME composition. */
export const composerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
  if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
};
