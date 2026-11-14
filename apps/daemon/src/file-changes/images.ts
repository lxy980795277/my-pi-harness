import { createHash } from 'node:crypto';
import type { FileChangeImage } from '@my-pi-harness/protocol';
import { hashFileBytes, type FileImage, type WorkspaceFileSnapshot } from '@my-pi-harness/sandbox';

/** File images compare exact bytes and supported mode bits; an absent target differs from empty. */
export function matchesFileImage(actual: FileImage, expected: FileChangeImage): boolean {
  if (!expected.exists) return actual.bytes === null;
  return (
    actual.bytes !== null &&
    actual.mode === expected.mode &&
    actual.bytes.byteLength === expected.bytes &&
    hashFileBytes(actual.bytes) === expected.sha256
  );
}

export function fileTargetKey(snapshot: WorkspaceFileSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify([snapshot.parentIdentity, snapshot.path]))
    .digest('hex');
}

/** Canonical JSON of host-constructed fields binds retries to the originally accepted request. */
export function fileRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
