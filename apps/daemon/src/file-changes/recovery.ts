import type { FileOperationObservation } from '@my-pi-harness/protocol/internal';
import { StorageError, type ProfileStore } from '@my-pi-harness/storage';
import { readWorkspaceFileSnapshot, sameFilesystemIdentity } from '@my-pi-harness/sandbox';
import { MAXIMUM_FILE_CHANGE_BYTES } from '@my-pi-harness/tools';
import { matchesFileImage } from './images';
import type { FileChangeService } from './service';

/** Startup only observes disk state; matching bytes cannot prove whether a past syscall executed. */
export async function recoverFileChanges(
  store: ProfileStore,
  files: FileChangeService,
): Promise<void> {
  let cursor = 0;
  for (;;) {
    const page = store.listPendingFileOperations(50, cursor);
    for (const operation of page.items) {
      let match: FileOperationObservation['match'] = 'unavailable';
      try {
        const context = await files.context(
          operation.intent.workspaceId,
          new AbortController().signal,
        );
        const snapshot = await readWorkspaceFileSnapshot(
          context,
          operation.intent.path,
          MAXIMUM_FILE_CHANGE_BYTES,
        );
        if (
          sameFilesystemIdentity(snapshot.rootIdentity, operation.intent.rootIdentity) &&
          sameFilesystemIdentity(snapshot.parentIdentity, operation.intent.parentIdentity)
        ) {
          const before = matchesFileImage(snapshot.image, operation.intent.before);
          const after = matchesFileImage(snapshot.image, operation.intent.after);
          match = before && after ? 'both' : before ? 'before' : after ? 'after' : 'other';
        }
      } catch (error) {
        if (error instanceof StorageError) throw error;
        // Missing, replaced or inaccessible workspaces give no publication evidence; no disk write is attempted.
        match = 'unavailable';
      }
      const at = Date.now();
      store.observeFileOperation(
        operation.sessionId,
        operation.intent.operationId,
        { match, at },
        at,
      );
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  cursor = 0;
  for (;;) {
    const page = store.listPendingFileChangeBatches(50, cursor);
    for (const { sessionId, receipt } of page.items) {
      for (const item of receipt.items) {
        if (item.status === 'running') {
          const operation =
            item.fileOperationId === null
              ? undefined
              : store.getFileOperation(sessionId, item.fileOperationId);
          const status = operation?.status;
          const confirmed =
            status === 'applied' || status === 'not_applied' || status === 'conflict';
          store.updateFileChangeBatchItem(
            sessionId,
            receipt.operationId,
            {
              ...item,
              status: confirmed ? status : 'unknown',
              error: confirmed
                ? (operation?.outcome?.error ?? null)
                : '服务在操作结算前中断，请核对文件。',
            },
            Date.now(),
          );
        } else if (item.status === 'not_started')
          store.updateFileChangeBatchItem(
            sessionId,
            receipt.operationId,
            { ...item, status: 'cancelled', error: '服务已重启，此项不会自动执行。' },
            Date.now(),
          );
      }
      store.finishFileChangeBatch(
        sessionId,
        receipt.operationId,
        'interrupted',
        '服务已重启，请查看各项结果；剩余操作不会自动恢复。',
        Date.now(),
      );
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
}
