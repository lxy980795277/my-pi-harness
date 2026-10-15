import { useCallback, useEffect, useRef } from 'react';

type RequestTask = <Result>(operation: (signal: AbortSignal) => Promise<Result>) => Promise<Result>;

/** Cancels view-owned writes when their view closes; server facts still require refetch. */
export const useRequestTask = (): RequestTask => {
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const activeControllers = controllers.current;
    return (): void => {
      for (const controller of activeControllers) {
        controller.abort();
      }
      activeControllers.clear();
    };
  }, []);

  return useCallback(
    async <Result>(operation: (signal: AbortSignal) => Promise<Result>): Promise<Result> => {
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        return await operation(controller.signal);
      } finally {
        controllers.current.delete(controller);
      }
    },
    [],
  );
};
