import { useCallback, useEffect } from 'react';
import {
  useFileChangesStore,
  type FileChangeScope,
} from '@/features/file-changes/stores/file-changes';

const EMPTY_SCOPE: FileChangeScope = {};

/** Entries carry stable recorded IDs only and never expose disk paths as operation input. */
export const useFileChangeEntry = (
  sessionId: string,
  scope: FileChangeScope = EMPTY_SCOPE,
  closeOnUnmount = false,
): (() => void) => {
  const open = useFileChangesStore((state) => {
    return state.open;
  });
  const close = useFileChangesStore((state) => {
    return state.close;
  });
  useEffect(() => {
    return (): void => {
      if (closeOnUnmount) close(sessionId);
    };
  }, [close, closeOnUnmount, sessionId]);
  return useCallback((): void => {
    open(sessionId, scope);
  }, [open, scope, sessionId]);
};
