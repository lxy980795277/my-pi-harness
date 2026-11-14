import { randomUUID } from 'node:crypto';
import {
  FilePublicationError,
  hashFileBytes,
  publishWorkspaceFile,
  readWorkspaceFileSnapshot,
} from '@my-pi-harness/sandbox';
import {
  MAXIMUM_FILE_CHANGE_BYTES,
  ToolError,
  type FileChangeToolHandlers,
  type WorkspaceToolContext,
} from '../../src/index';

/** Tool tests exercise actual filesystem semantics; durable history belongs to daemon integration tests. */
export function testFileChanges(context: WorkspaceToolContext): FileChangeToolHandlers {
  return {
    async modify(input, invocation) {
      const current = { ...context, signal: invocation.signal };
      const before = await readWorkspaceFileSnapshot(
        current,
        input.path,
        MAXIMUM_FILE_CHANGE_BYTES,
      );
      const hash = before.image.bytes === null ? null : hashFileBytes(before.image.bytes);
      if (hash !== input.expectedHash)
        throw new ToolError('PREIMAGE_MISMATCH', 'The file changed before writing');
      const prepared = input.prepare(
        before.image.bytes === null ? null : Uint8Array.from(before.image.bytes),
      );
      try {
        await publishWorkspaceFile(
          current,
          before,
          { bytes: prepared.content, mode: before.image.mode ?? 0o600 },
          () => invocation.beforePublish(randomUUID()),
        );
      } catch (error) {
        if (error instanceof FilePublicationError && error.publication === 'not-published')
          invocation.confirmNotPublished();
        throw error;
      }
      return prepared.result;
    },
  };
}
