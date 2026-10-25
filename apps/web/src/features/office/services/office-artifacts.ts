import type { OfficeArtifact } from '@my-pi-harness/protocol';
import { getBlob } from '@/services/base-request';
import { officeArtifactMediaType } from '@/features/office/utils/office-artifact';

/** Host resolves the recorded tool's artifact; the client supplies no arbitrary filesystem target. */
export const downloadOfficeArtifact = async (
  sessionId: string,
  toolId: string,
  artifact: OfficeArtifact,
  signal: AbortSignal,
): Promise<Blob> => {
  const blob = await getBlob(
    `/sessions/${encodeURIComponent(sessionId)}/tools/${encodeURIComponent(toolId)}/artifact`,
    officeArtifactMediaType(artifact),
    signal,
  );
  if (blob.size !== artifact.bytes)
    throw new Error('文档大小与本次工具记录不一致，请核对当前文件。');
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(hash))
    .map((byte) => {
      return byte.toString(16).padStart(2, '0');
    })
    .join('');
  if (sha256 !== artifact.sha256) throw new Error('文档内容与本次工具记录不一致，请核对当前文件。');
  return blob;
};
