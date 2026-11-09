import { useCallback, useEffect, useRef } from 'react';
import { useAsyncEvent, type AsyncEvent } from '@/hooks/use-async-event';

type LoadBlob = (signal: AbortSignal) => Promise<Blob>;

/** Owner identity scopes cancellation; same-target renders may replace the producer or filename. */
export const useBlobDownload = (
  owner: string,
  load: LoadBlob,
  filename: string,
): AsyncEvent<[]> => {
  const url = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const release = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (url.current !== null) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
  }, []);
  const download = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const blob = await load(signal);
        signal.throwIfAborted();
        release();
        url.current = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url.current;
        link.download = filename;
        try {
          document.body.append(link);
          link.click();
        } catch (error: unknown) {
          release();
          throw error;
        } finally {
          link.remove();
        }
        // Chromium consumes the object URL after the click handler returns.
        timer.current = window.setTimeout(release, 1_000);
      },
      [filename, load, release],
    ),
  );
  const { cancel } = download;
  useEffect(() => {
    return (): void => {
      cancel();
      release();
    };
  }, [cancel, owner, release]);
  return download;
};
