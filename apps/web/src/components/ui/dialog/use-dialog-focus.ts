import { useCallback, useRef } from 'react';

type FocusCallback = (event: Event) => void;
interface DialogFocusHandlers {
  open: FocusCallback;
  close: FocusCallback;
}

/** Controlled dialogs remember their actual opener even without a Radix Trigger. */
export const useDialogFocus = (
  onOpen: FocusCallback | undefined,
  onClose: FocusCallback | undefined,
): DialogFocusHandlers => {
  const opener = useRef<HTMLElement | null>(null);
  const parentDialog = useRef<HTMLElement | null>(null);
  const open = useCallback(
    (event: Event): void => {
      if (document.activeElement instanceof HTMLElement) {
        opener.current = document.activeElement;
        parentDialog.current = document.activeElement.closest<HTMLElement>(
          '[role="dialog"], [role="alertdialog"]',
        );
      }
      onOpen?.(event);
    },
    [onOpen],
  );
  const close = useCallback(
    (event: Event): void => {
      onClose?.(event);
      if (event.defaultPrevented) {
        return;
      }
      let target = opener.current;
      if (!target?.isConnected) {
        target = parentDialog.current;
      }
      if (target?.isConnected) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
    [onClose],
  );
  return { open, close };
};
