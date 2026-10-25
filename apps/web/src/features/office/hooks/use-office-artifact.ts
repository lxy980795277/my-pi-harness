import { useCallback, useEffect, useRef } from 'react';
import type { ToolCallView } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { downloadOfficeArtifact } from '@/features/office/services/office-artifacts';
import {
  officeArtifactFilename,
  readOfficeArtifact,
} from '@/features/office/utils/office-artifact';
import type { OfficeArtifactState } from '@/features/office/types/office';

/** Download URLs belong to this mounted disclosure and are revoked after the browser consumes them. */
export const useOfficeArtifact = (tool: ToolCallView): OfficeArtifactState => {
  const artifact = readOfficeArtifact(tool);
  let filename = '';
  if (artifact !== null) filename = officeArtifactFilename(artifact);
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
        if (artifact === null) throw new Error('本次工具没有可下载的文档。');
        const blob = await downloadOfficeArtifact(tool.sessionId, tool.id, artifact, signal);
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
      [artifact, filename, release, tool.id, tool.sessionId],
    ),
  );
  return {
    artifact,
    filename,
    download: download.run,
    pending: download.pending,
    error: download.error,
  };
};
