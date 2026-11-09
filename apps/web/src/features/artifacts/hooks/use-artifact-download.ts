import { useCallback } from 'react';
import type { Artifact } from '@my-pi-harness/protocol';
import { useBlobDownload } from '@/hooks/use-blob-download';
import { downloadArtifact } from '@/features/artifacts/services/artifacts';
import { artifactFilename } from '@/features/artifacts/utils/artifacts';
import type { ArtifactDownloadState } from '@/features/artifacts/types/artifacts';

/** Download URLs belong to the mounted card and are revoked after the browser consumes them. */
export const useArtifactDownload = (artifact: Artifact): ArtifactDownloadState => {
  const filename = artifactFilename(artifact);
  const download = useBlobDownload(
    JSON.stringify([artifact.sessionId, artifact.id]),
    useCallback(
      (signal: AbortSignal): Promise<Blob> => {
        return downloadArtifact(artifact, signal);
      },
      [artifact],
    ),
    filename,
  );
  return { filename, download: download.run, pending: download.pending, error: download.error };
};
