import { randomUUID } from 'node:crypto';
import {
  FilePublicationError,
  hashFileBytes,
  publishWorkspaceFile,
  readWorkspaceFileSnapshot,
  sameFileImage,
} from '@my-pi-harness/sandbox';
import { MAXIMUM_FILE_CHANGE_BYTES, ToolError } from '@my-pi-harness/tools';
import type { FileChangeImage } from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { ToolRuntimeOptions } from '../../src/tools/types';
import { RuntimeError } from '../../src/errors';

type TestFileStore = Pick<
  ProfileStore,
  | 'putFileChangeBytes'
  | 'abandonFileChangeBytes'
  | 'prepareFileOperation'
  | 'completeFileOperation'
  | 'getFileChangeHead'
>;

/** Runtime fixtures keep real ledger checks; daemon tests own serialization, recovery and history behavior. */
export function testFileChanges(
  profileDirectory: string,
  resolveWorkspace: ToolRuntimeOptions['resolveWorkspace'],
  store?: TestFileStore,
): NonNullable<ToolRuntimeOptions['fileChanges']> {
  return (context) => ({
    async modify(input, invocation) {
      if (context.session.workspaceId === null)
        throw new RuntimeError('WORKSPACE_REQUIRED', 'Workspace required');
      const workspace = await resolveWorkspace(context.session.workspaceId);
      const current = {
        workspaceRoot: workspace.rootPath,
        profileDirectory,
        signal: invocation.signal,
      };
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
      const after = { bytes: prepared.content, mode: before.image.mode ?? 0o600 };
      if (sameFileImage(before.image, after)) return prepared.result;
      const operationId = randomUUID();
      if (store) {
        const pins: string[] = [];
        const image = (bytes: Uint8Array | null, mode: number | null): FileChangeImage => {
          if (bytes === null) return { exists: false };
          const blob = store.putFileChangeBytes(bytes);
          pins.push(blob.sha256);
          return { exists: true, ...blob, mode: mode ?? 0o600 };
        };
        try {
          const targetKey = hashFileBytes(
            Buffer.from(JSON.stringify([workspace.id, before.rootIdentity, before.relativePath])),
          );
          store.prepareFileOperation(
            context.session.id,
            {
              operationId,
              action: 'write',
              targetChangeId: null,
              workspaceId: workspace.id,
              path: before.relativePath,
              branchId: context.run.branchId,
              source: { kind: 'tool', toolCallId: invocation.toolCallId },
              before: image(before.image.bytes, before.image.mode),
              after: image(after.bytes, after.mode),
              requestHash: hashFileBytes(
                Buffer.from(JSON.stringify([operationId, input.expectedHash])),
              ),
              targetKey,
              expectedRevision: store.getFileChangeHead(targetKey).revision,
              rootIdentity: before.rootIdentity,
              parentIdentity: before.parentIdentity,
            },
            context.run.id,
            Date.now(),
          );
        } finally {
          for (const pin of pins) store.abandonFileChangeBytes(pin);
        }
      }
      try {
        await publishWorkspaceFile(current, before, after, () =>
          invocation.beforePublish(operationId),
        );
      } catch (error) {
        const notPublished =
          error instanceof FilePublicationError && error.publication === 'not-published';
        if (notPublished) invocation.confirmNotPublished();
        store?.completeFileOperation(
          context.session.id,
          operationId,
          { status: notPublished ? 'not_applied' : 'unknown', error: 'Fixture publication failed' },
          Date.now(),
        );
        throw error;
      }
      store?.completeFileOperation(
        context.session.id,
        operationId,
        { status: 'applied', error: null },
        Date.now(),
      );
      return prepared.result;
    },
  });
}
