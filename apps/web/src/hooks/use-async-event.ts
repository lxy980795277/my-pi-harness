import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError } from '@/utils/describe-error';

type EventOperation<Arguments extends readonly unknown[]> = (
  signal: AbortSignal,
  ...arguments_: Arguments
) => Promise<void>;

export interface AsyncEvent<Arguments extends readonly unknown[]> {
  run: (...arguments_: Arguments) => void;
  pending: boolean;
  error: string | null;
  clearError: () => void;
  /** Ends this UI task and clears feedback; committed server facts still require reconciliation. */
  cancel: () => void;
}

/** Owns one synchronous UI event bridge, including cancellation, duplicate clicks and failures. */
export const useAsyncEvent = <Arguments extends readonly unknown[]>(
  operation: EventOperation<Arguments>,
): AsyncEvent<Arguments> => {
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);

  const execute = useCallback(
    async (...arguments_: Arguments): Promise<void> => {
      if (active.current !== null || !mounted.current) {
        return;
      }
      const controller = new AbortController();
      active.current = controller;
      setPending(true);
      setError(null);
      try {
        await operation(controller.signal, ...arguments_);
      } catch (failure: unknown) {
        if (mounted.current && !controller.signal.aborted) {
          setError(describeError(failure));
        }
      } finally {
        if (active.current === controller) {
          active.current = null;
          if (mounted.current) {
            setPending(false);
          }
        }
      }
    },
    [operation],
  );

  const run = useCallback(
    (...arguments_: Arguments): void => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- execute handles failures and cancellation.
      execute(...arguments_);
    },
    [execute],
  );
  const clearError = useCallback((): void => {
    setError(null);
  }, []);
  const cancel = useCallback((): void => {
    const controller = active.current;
    active.current = null;
    controller?.abort();
    if (mounted.current) {
      setPending(false);
      setError(null);
    }
  }, []);

  return { run, pending, error, clearError, cancel };
};
