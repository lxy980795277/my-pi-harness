import { randomUUID } from 'node:crypto';
import type {
  FileChangeBatchInput,
  FileChangeBatchReceipt,
  FileChangeImage,
} from '@my-pi-harness/protocol';
import type { FileChangeHead, FileChangeRecord } from '@my-pi-harness/protocol/internal';
import { StorageError, type ProfileStore } from '@my-pi-harness/storage';
import { sameFilesystemIdentity } from '@my-pi-harness/sandbox';
import { FileChangeError } from './errors';
import { fileRequestHash } from './images';
import type { FileChangeService } from './service';

interface BatchOptions {
  store: ProfileStore;
  files: FileChangeService;
  onError(error: unknown): void;
}
interface SimulatedTarget {
  head: FileChangeHead;
  image: FileChangeImage;
  first: FileChangeRecord;
}
interface BatchJob {
  controller: AbortController;
  promise: Promise<void>;
}

function sameImage(left: FileChangeImage, right: FileChangeImage): boolean {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  return left.sha256 === right.sha256 && left.bytes === right.bytes && left.mode === right.mode;
}

/** Durable receipts outlive HTTP connections; cancellation waits for each started publication. */
export class FileChangeBatches {
  private accepting = true;
  private readonly jobs = new Map<string, BatchJob>();
  public constructor(private readonly options: BatchOptions) {}

  public stopAccepting(): void {
    this.accepting = false;
    for (const job of this.jobs.values()) job.controller.abort();
  }

  public async close(): Promise<void> {
    this.stopAccepting();
    await Promise.allSettled([...this.jobs.values()].map((job) => job.promise));
  }

  /** Return only after acceptance is durable; a lost response never starts a second job. */
  public accept(sessionId: string, input: FileChangeBatchInput): FileChangeBatchReceipt {
    if (!this.accepting) throw new FileChangeError('FILE_CHANGE_CLOSED', '文件变更服务已关闭。');
    if (this.options.store.getSession(sessionId) === undefined)
      throw new FileChangeError('FILE_CHANGE_NOT_FOUND', '会话不存在。', 404);
    const selection =
      input.selection.kind === 'changes'
        ? { kind: input.selection.kind, changeIds: [...input.selection.changeIds].sort() }
        : input.selection;
    const requestHash = fileRequestHash([input.action, selection]);
    const existing = this.options.store.findFileChangeBatch(
      sessionId,
      input.operationId,
      requestHash,
    );
    if (existing !== undefined) return existing;
    const records = this.selection(sessionId, input);
    records.sort((left, right) =>
      input.action === 'undo'
        ? right.operation.seq - left.operation.seq
        : left.operation.seq - right.operation.seq,
    );
    const receipt = this.options.store.acceptFileChangeBatch(
      sessionId,
      {
        operationId: input.operationId,
        requestHash,
        action: input.action,
        items: records.map((record) => ({
          changeId: record.operation.intent.operationId,
          path: record.operation.intent.path,
        })),
      },
      Date.now(),
    );
    const key = JSON.stringify([sessionId, input.operationId]);
    if (receipt.status !== 'accepted' || this.jobs.has(key)) return receipt;
    const controller = new AbortController();
    const promise = this.execute(sessionId, receipt, controller.signal)
      .catch((error: unknown) => {
        // A frozen journal retains the last durable receipt for startup recovery; it cannot record a fake failure.
        this.options.onError(error);
      })
      .finally(() => this.jobs.delete(key));
    this.jobs.set(key, { controller, promise });
    return receipt;
  }

  public cancel(sessionId: string, operationId: string): FileChangeBatchReceipt {
    const receipt = this.options.store.requestFileChangeBatchCancel(
      sessionId,
      operationId,
      Date.now(),
    );
    this.jobs.get(JSON.stringify([sessionId, operationId]))?.controller.abort();
    return receipt;
  }

  private selection(sessionId: string, input: FileChangeBatchInput): FileChangeRecord[] {
    let ids: string[];
    if (input.selection.kind === 'answer') {
      const page = this.options.store.listFileChanges(sessionId, {
        inputMessageId: input.selection.inputMessageId,
        limit: 50,
      });
      if (page.nextCursor !== null)
        throw new FileChangeError('FILE_CHANGE_LIMIT', '本次回答超过 50 项变更，请分批选择。', 422);
      ids = page.items.map((item) => item.changeId);
    } else ids = input.selection.changeIds;
    if (ids.length === 0)
      throw new FileChangeError('FILE_CHANGE_EMPTY', '所选范围没有受管文件变更。', 422);
    return ids.map((id) => {
      try {
        return this.options.store.getFileChangeRecord(sessionId, id);
      } catch (cause) {
        if (cause instanceof StorageError && cause.code.endsWith('NOT_FOUND'))
          throw new FileChangeError('FILE_CHANGE_NOT_FOUND', '所选文件变更不存在。', 404, {
            cause,
          });
        throw cause;
      }
    });
  }

  /** Simulate each selected chain before writing; older selected revisions need not be current heads yet. */
  private async preflight(
    sessionId: string,
    receipt: FileChangeBatchReceipt,
    signal: AbortSignal,
  ): Promise<Map<string, string>> {
    const conflicts = new Map<string, string>();
    const simulated = new Map<string, SimulatedTarget>();
    for (const item of receipt.items) {
      signal.throwIfAborted();
      const record = this.options.store.getFileChangeRecord(sessionId, item.changeId);
      const intent = record.operation.intent;
      try {
        let target = simulated.get(intent.targetKey);
        if (target === undefined) {
          await this.options.files.check(record, receipt.action, signal);
          target = {
            head: structuredClone(this.options.store.getFileChangeHead(intent.targetKey)),
            image: receipt.action === 'undo' ? intent.after : intent.before,
            first: record,
          };
          simulated.set(intent.targetKey, target);
        }
        const { head } = target;
        const eligible =
          receipt.action === 'undo'
            ? record.applied && head.headChangeId === item.changeId
            : !record.applied &&
              head.redoTopChangeId === item.changeId &&
              head.redoEpoch === record.redoEpoch;
        if (
          !record.local ||
          record.operation.status !== 'applied' ||
          !eligible ||
          head.pendingOperationId !== null ||
          head.uncertainOperationId !== null ||
          !sameFilesystemIdentity(
            target.first.operation.intent.rootIdentity,
            intent.rootIdentity,
          ) ||
          !sameFilesystemIdentity(
            target.first.operation.intent.parentIdentity,
            intent.parentIdentity,
          ) ||
          !sameImage(target.image, receipt.action === 'undo' ? intent.after : intent.before)
        )
          throw new FileChangeError(
            'FILE_CHANGE_CONFLICT',
            '所选变更不连续，或文件变更顺序已改变。',
          );
        if (receipt.action === 'undo') {
          head.headChangeId = record.previousChangeId;
          head.redoTopChangeId = item.changeId;
        } else {
          head.headChangeId = item.changeId;
          head.redoTopChangeId = record.redoNextChangeId;
        }
        target.image = receipt.action === 'undo' ? intent.before : intent.after;
        head.revision += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof StorageError) throw error;
        conflicts.set(
          item.changeId,
          error instanceof FileChangeError ? error.message : '文件当前不可安全恢复。',
        );
      }
    }
    return conflicts;
  }

  private async execute(
    sessionId: string,
    accepted: FileChangeBatchReceipt,
    signal: AbortSignal,
  ): Promise<void> {
    const { store, files } = this.options;
    try {
      await files.gate.run(signal, async (currentSignal) => {
        const conflicts = await this.preflight(sessionId, accepted, currentSignal);
        for (const item of accepted.items) {
          if (currentSignal.aborted) break;
          const conflict = conflicts.get(item.changeId);
          if (conflict !== undefined) {
            store.updateFileChangeBatchItem(
              sessionId,
              accepted.operationId,
              { ...item, status: 'conflict', error: conflict },
              Date.now(),
            );
            continue;
          }
          const fileOperationId = randomUUID();
          try {
            const outcome = await files.restore(
              sessionId,
              item.changeId,
              accepted.action,
              fileOperationId,
              currentSignal,
              () => {
                store.updateFileChangeBatchItem(
                  sessionId,
                  accepted.operationId,
                  { ...item, fileOperationId, status: 'running' },
                  Date.now(),
                );
              },
            );
            store.updateFileChangeBatchItem(
              sessionId,
              accepted.operationId,
              {
                ...item,
                fileOperationId,
                status: outcome.status === 'prepared' ? 'unknown' : outcome.status,
                error: outcome.outcome?.error ?? null,
              },
              Date.now(),
            );
          } catch (error) {
            const outcome = store.getFileOperation(sessionId, fileOperationId);
            if (error instanceof StorageError) throw error;
            const status = outcome?.status;
            store.updateFileChangeBatchItem(
              sessionId,
              accepted.operationId,
              {
                ...item,
                fileOperationId: outcome === undefined ? null : fileOperationId,
                status:
                  status === 'unknown' || status === 'prepared'
                    ? 'unknown'
                    : status === 'not_applied'
                      ? 'not_applied'
                      : 'conflict',
                error:
                  error instanceof FileChangeError
                    ? error.message
                    : '文件操作未能完成，请核对当前文件。',
              },
              Date.now(),
            );
          }
        }
      });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    const current = store.getFileChangeBatch(sessionId, accepted.operationId);
    for (const item of current.items) {
      if (item.status === 'not_started')
        store.updateFileChangeBatchItem(
          sessionId,
          accepted.operationId,
          { ...item, status: 'cancelled', error: '操作已停止，此项未执行。' },
          Date.now(),
        );
    }
    const final = store.getFileChangeBatch(sessionId, accepted.operationId);
    const completed = final.items.every((item) => item.status === 'applied');
    const partial = final.items.some(
      (item) => item.status === 'applied' || item.status === 'unknown',
    );
    const status = completed
      ? 'completed'
      : signal.aborted
        ? 'cancelled'
        : partial
          ? 'partial'
          : 'failed';
    store.finishFileChangeBatch(sessionId, accepted.operationId, status, null, Date.now());
  }
}
