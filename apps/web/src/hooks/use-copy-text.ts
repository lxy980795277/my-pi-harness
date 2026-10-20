import { useCallback, useEffect, useRef, useState } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface CopyTextState {
  copied: boolean;
  copy: () => void;
  pending: boolean;
  error: string | null;
}

/** Copy exact text and own feedback until expiry, content change or unmount. */
export const useCopyText = (text: string): CopyTextState => {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);
  const operation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await navigator.clipboard.writeText(text);
        signal.throwIfAborted();
        setCopiedText(text);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setCopiedText(null);
          timer.current = null;
        }, 2000);
      },
      [text],
    ),
  );
  return {
    copy: operation.run,
    pending: operation.pending,
    error: operation.error,
    copied: copiedText === text,
  };
};
