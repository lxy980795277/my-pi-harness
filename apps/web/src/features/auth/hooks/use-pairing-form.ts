import type { PairingFormState } from '@/features/auth/types/auth';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** One-time codes are cleared before the private async operation starts. */
export const usePairingForm = (onPair: (code: string) => Promise<void>): PairingFormState => {
  const [code, setCode] = useState('');
  const pairing = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, value: string): Promise<void> => {
        await onPair(value);
      },
      [onPair],
    ),
  );
  const { run: pairingRun } = pairing;
  const change = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setCode(event.target.value);
  }, []);
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const submitted = code;
      setCode('');
      pairingRun(submitted);
    },
    [code, pairingRun],
  );
  return { code, change, submit, pending: pairing.pending, error: pairing.error };
};
