import type { Artifact } from '@my-pi-harness/protocol';
import { getBlob } from '@/services/base-request';

/** Download the host's immutable artifact snapshot by identity and verify its recorded bytes. */
export const downloadArtifact = async (artifact: Artifact, signal: AbortSignal): Promise<Blob> => {
  const blob = await getBlob(
    `/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.id)}`,
    artifact.mediaType,
    signal,
  );
  if (blob.size !== artifact.bytes) throw new Error('文件大小与产物记录不一致。');
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(hash))
    .map((byte) => {
      return byte.toString(16).padStart(2, '0');
    })
    .join('');
  if (sha256 !== artifact.sha256) throw new Error('文件内容与产物记录不一致。');
  return blob;
};
