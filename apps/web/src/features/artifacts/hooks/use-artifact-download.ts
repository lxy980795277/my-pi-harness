import { useCallback, useEffect, useRef } from 'react';
import type { Artifact } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { downloadArtifact } from '@/features/artifacts/services/artifacts';
import { artifactFilename } from '@/features/artifacts/utils/artifacts';
import type { ArtifactDownloadState } from '@/features/artifacts/types/artifacts';

/** Download URLs belong to the mounted card and are revoked after the browser consumes them. */
export const useArtifactDownload = (artifact: Artifact): ArtifactDownloadState => {
  const filename = artifactFilename(artifact);
  const url = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (url.current !== null) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  useEffect(() => {
    return release;
  }, [release]);
  const download = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const blob = await downloadArtifact(artifact, signal);
        signal.throwIfAborted();
        release();
        url.current = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url.current;
        link.download = filename;
        document.body.append(link);
        try {
          link.click();
        } catch (error: unknown) {
          release();
          throw error;
        } finally {
          link.remove();
        }
        timer.current = setTimeout(release, 1000);
      },
      [artifact, filename, release],
    ),
  );
  return { filename, download: download.run, pending: download.pending, error: download.error };
};
