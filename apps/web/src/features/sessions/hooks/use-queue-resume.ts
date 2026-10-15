import { useCallback } from 'react';
import { useAsyncEvent, type AsyncEvent } from '@/hooks/use-async-event';

/** Resuming remains an explicit action after a stopped or recovered run. */
export const useQueueResume = (onResume: () => Promise<void>): AsyncEvent<[]> => {
  return useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await onResume();
    }, [onResume]),
  );
};
