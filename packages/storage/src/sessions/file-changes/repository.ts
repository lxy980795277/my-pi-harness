import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';
import {
  FileChangesQuerySchema,
  FileChangesPageSchema,
  FileChangeDetailQuerySchema,
  FileChangeSummarySchema,
  FileChangeBatchQuerySchema,
  FileChangeBatchPageSchema,
  FileChangeBatchReceiptSchema,
  FileChangeBatchItemSchema,
  type FileChangeSummary,
  type FileChangesQuery,
  type FileChangesPage,
  type FileChangeDetailQuery,
  type FileChangeDetail,
  type FileChangeBatchReceipt,
  type FileChangeBatchItem,
  type FileChangeBatchQuery,
  type FileChangeBatchPage,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import {
  FileOperationPrepareSchema,
  FileOperationIntentSchema,
  FileOperationHostSchema,
  FileOperationOutcomeSchema,
  FileOperationObservationSchema,
  FileOperationRecordSchema,
  FileChangeBatchAcceptSchema,
  type EventInput,
  type FileOperationPrepare,
  type FileOperationOutcome,
  type FileOperationObservation,
  type FileOperationRecord,
  type FileChangeRecord,
  type FileChangeHead,
  type FileChangeBatchAccept,
} from '@my-pi-harness/protocol/internal';
import type { ArtifactBlobs } from '../../artifacts/blobs';
import { StorageError } from '../../shared/errors';
import { checked } from '../../shared/validation';
import { traceSession } from '../trace-scope';
import { head, operation, requireChange, requireOperation, fileSourceRow } from './records';
import { batch, activeBatch } from './batches';
import { fileChangeContent } from './content';

export interface PendingFileOperations {
  items: FileOperationRecord[];
  nextCursor: number | null;
}
export interface PendingFileBatches {
  items: Array<{ sessionId: string; receipt: FileChangeBatchReceipt }>;
  nextCursor: number | null;
}
type Append = (sessionId: string, inputs: readonly EventInput[]) => HarnessEvent[];
const idRow = Type.Object({ id: Type.String(), seq: Type.Integer() });
const pendingRow = Type.Object({ cursor: Type.Integer(), data: Type.String() });
const pendingBatchRow = Type.Object({
  cursor: Type.Integer(),
  session_id: Type.String(),
  data: Type.String(),
});
const hashRow = Type.Object({ sha256: Type.String(), bytes: Type.Integer() });

/** Coordinates durable operation intent, query projections and immutable image references. */
export class FileChangeRepository {
  public constructor(
    private readonly db: Database.Database,
    private readonly blobs: ArtifactBlobs,
    private readonly append: Append,
  ) {}

  private event(
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
    runId: string | null,
    at: number,
    privateData?: Record<string, unknown>,
  ): void {
    this.append(sessionId, [
      { type, data, runId, at, ...(privateData === undefined ? {} : { privateData }) },
    ]);
  }

  public prepare(
    sessionId: string,
    input: FileOperationPrepare,
    runId: string | null,
    at: number,
  ): FileOperationRecord {
    traceSession(this.db, sessionId);
    const intent = checked(FileOperationPrepareSchema, { ...input, local: true });
    const existing = operation(this.db, intent.operationId);
    if (existing !== undefined) {
      if (
        existing.sessionId !== sessionId ||
        existing.runId !== runId ||
        !isDeepStrictEqual(existing.intent, intent)
      )
        throw new StorageError(
          'FILE_CHANGE_OPERATION_CONFLICT',
          'File operation ID was already accepted with different content',
        );
      return existing;
    }
    if (
      this.db.prepare('SELECT 1 FROM file_change_batches WHERE id=?').get(input.operationId) !==
      undefined
    )
      throw new StorageError(
        'FILE_CHANGE_OPERATION_CONFLICT',
        'File operation ID belongs to another operation',
      );
    if (
      intent.path.startsWith('/') ||
      intent.path.includes('\0') ||
      intent.path.split(/[\\/]/).some((part) => part === '..' || part === '')
    )
      throw new StorageError(
        'INVALID_RECORD',
        'File history paths must be relative workspace paths',
      );
    const {
      requestHash,
      targetKey,
      rootIdentity,
      parentIdentity,
      expectedRevision,
      local,
      ...publicIntent
    } = intent;
    checked(FileOperationIntentSchema, publicIntent);
    const host = checked(FileOperationHostSchema, {
      requestHash,
      targetKey,
      rootIdentity,
      parentIdentity,
      expectedRevision,
      local,
    });
    this.event(sessionId, 'file.operation.prepared', publicIntent, runId, at, {
      fileOperationHost: host,
    });
    return requireOperation(this.db, sessionId, intent.operationId);
  }

  public complete(
    sessionId: string,
    id: string,
    result: FileOperationOutcome,
    at: number,
  ): FileOperationRecord {
    checked(FileOperationOutcomeSchema, result);
    const current = requireOperation(this.db, sessionId, id);
    if (current.status !== 'prepared') {
      if (!isDeepStrictEqual(current.outcome, result))
        throw new StorageError('CONFLICT', 'File operation already has a different result');
      return current;
    }
    this.event(
      sessionId,
      'file.operation.completed',
      { operationId: id, outcome: result },
      current.runId,
      at,
    );
    return requireOperation(this.db, sessionId, id);
  }

  public observe(
    sessionId: string,
    id: string,
    observation: FileOperationObservation,
    at: number,
  ): FileOperationRecord {
    checked(FileOperationObservationSchema, observation);
    const current = requireOperation(this.db, sessionId, id);
    if (isDeepStrictEqual(current.observation, observation)) return current;
    this.event(
      sessionId,
      'file.operation.observed',
      { operationId: id, observation },
      current.runId,
      at,
    );
    return requireOperation(this.db, sessionId, id);
  }

  public getOperation(sessionId: string, id: string): FileOperationRecord | undefined {
    traceSession(this.db, sessionId);
    const value = operation(this.db, id);
    return value?.sessionId === sessionId ? value : undefined;
  }
  public getRecord(sessionId: string, id: string): FileChangeRecord {
    traceSession(this.db, sessionId);
    return requireChange(this.db, sessionId, id);
  }
  public getHead(targetKey: string): FileChangeHead {
    return head(this.db, targetKey);
  }

  private summary(record: FileChangeRecord): FileChangeSummary {
    const original = record.operation;
    const intent = original.intent;
    const current = head(this.db, intent.targetKey);
    const source = checked(
      fileSourceRow,
      this.db
        .prepare('SELECT tool_call_id,answer_input_message_id,task_id FROM file_changes WHERE id=?')
        .get(intent.operationId),
    );
    const blocked = !record.local
      ? '导入的文件历史仅供查看'
      : original.status !== 'applied'
        ? '文件写入结果尚未确认'
        : current.pendingOperationId !== null
          ? '另一个文件操作正在发布'
          : current.uncertainOperationId !== null
            ? '当前文件历史存在未确认的写入'
            : null;
    const undoAvailable =
      blocked === null && record.applied && current.headChangeId === intent.operationId;
    const redoAvailable =
      blocked === null &&
      !record.applied &&
      current.redoTopChangeId === intent.operationId &&
      record.redoEpoch === current.redoEpoch;
    const blockedReason =
      blocked ??
      (undoAvailable || redoAvailable
        ? null
        : record.applied
          ? '请先撤销较新的文件变更'
          : record.redoEpoch !== current.redoEpoch
            ? '新的写入已使这次重做失效'
            : '请先重做更早的文件变更');
    return checked(FileChangeSummarySchema, {
      changeId: intent.operationId,
      sessionId: original.sessionId,
      seq: original.seq,
      workspaceId: intent.workspaceId,
      path: intent.path,
      branchId: intent.branchId,
      runId: original.runId,
      taskId: source.task_id,
      toolCallId: source.tool_call_id,
      answerInputMessageId: source.answer_input_message_id,
      before: intent.before,
      after: intent.after,
      createdAt: original.createdAt,
      updatedAt: original.finishedAt ?? original.createdAt,
      status: original.status,
      state:
        original.status === 'applied' ? (record.applied ? 'applied' : 'undone') : 'unavailable',
      revision: current.revision,
      local: record.local,
      undoAvailable,
      redoAvailable,
      blockedReason,
    });
  }

  public list(sessionId: string, query: FileChangesQuery = {}): FileChangesPage {
    traceSession(this.db, sessionId);
    checked(FileChangesQuerySchema, query);
    const clauses = ['session_id=?'];
    const args: Array<string | number> = [sessionId];
    if (query.toolCallId !== undefined) {
      clauses.push('tool_call_id=?');
      args.push(query.toolCallId);
    }
    if (query.inputMessageId !== undefined) {
      clauses.push('answer_input_message_id=?');
      args.push(query.inputMessageId);
    }
    const canOperate =
      this.db
        .prepare(
          `SELECT 1 FROM file_changes WHERE ${clauses.join(' AND ')} AND json_extract(data,'$.local')=1 AND json_extract(data,'$.operation.status')='applied' LIMIT 1`,
        )
        .get(...args) !== undefined;
    if (query.cursor !== undefined) {
      clauses.push('seq<?');
      args.push(query.cursor);
    }
    const limit = query.limit ?? 25;
    const rows = this.db
      .prepare(
        `SELECT id,seq FROM file_changes WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`,
      )
      .all(...args, limit + 1)
      .map((row) => checked(idRow, row));
    return checked(FileChangesPageSchema, {
      canOperate,
      items: rows
        .slice(0, limit)
        .map((row) => this.summary(requireChange(this.db, sessionId, row.id))),
      nextCursor: rows.length > limit ? (rows[limit - 1]?.seq ?? null) : null,
    });
  }
  public detail(
    sessionId: string,
    id: string,
    query: FileChangeDetailQuery = {},
  ): FileChangeDetail {
    traceSession(this.db, sessionId);
    checked(FileChangeDetailQuerySchema, query);
    return fileChangeContent(
      this.blobs,
      this.summary(requireChange(this.db, sessionId, id)),
      query,
    );
  }

  /** Archived histories still own shared target locks until startup records their uncertain outcome. */
  public pending(limit = 50, cursor = 0): PendingFileOperations {
    this.pagination(limit, cursor);
    const rows = this.db
      .prepare(
        `SELECT rowid AS cursor,data FROM file_operations WHERE rowid>? AND (json_extract(data,'$.status')='prepared' OR json_extract(data,'$.status')='unknown' AND json_extract(data,'$.observation') IS NULL) ORDER BY rowid LIMIT ?`,
      )
      .all(cursor, limit + 1)
      .map((row) => checked(pendingRow, row));
    return {
      items: rows
        .slice(0, limit)
        .map((row) => checked(FileOperationRecordSchema, JSON.parse(row.data))),
      nextCursor: rows.length > limit ? (rows[limit - 1]?.cursor ?? null) : null,
    };
  }
  private pagination(limit: number, cursor: number): void {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0
    )
      throw new StorageError('FILE_CHANGE_QUERY_INVALID', 'File history pagination is invalid');
  }

  public acceptBatch(
    sessionId: string,
    input: FileChangeBatchAccept,
    at: number,
  ): FileChangeBatchReceipt {
    traceSession(this.db, sessionId);
    checked(FileChangeBatchAcceptSchema, input);
    const existing = batch(this.db, sessionId, input.operationId);
    if (existing !== undefined) {
      if (existing.requestHash !== input.requestHash || existing.receipt.action !== input.action)
        throw new StorageError(
          'FILE_CHANGE_OPERATION_CONFLICT',
          'File batch ID was already accepted with different content',
        );
      return existing.receipt;
    }
    if (operation(this.db, input.operationId) !== undefined)
      throw new StorageError(
        'FILE_CHANGE_OPERATION_CONFLICT',
        'File batch ID belongs to another operation',
      );
    const receipt: FileChangeBatchReceipt = {
      operationId: input.operationId,
      action: input.action,
      status: 'accepted',
      cancelRequested: false,
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
      items: input.items.map((item) => ({
        ...item,
        fileOperationId: null,
        status: 'not_started',
        error: null,
      })),
      error: null,
    };
    this.event(sessionId, 'file.batch.accepted', receipt, null, at, {
      fileBatchHost: { requestHash: input.requestHash },
    });
    return this.getBatch(sessionId, input.operationId);
  }
  public findBatch(
    sessionId: string,
    id: string,
    requestHash: string,
  ): FileChangeBatchReceipt | undefined {
    traceSession(this.db, sessionId);
    const value = batch(this.db, sessionId, id);
    if (value !== undefined) {
      if (value.requestHash !== requestHash)
        throw new StorageError(
          'FILE_CHANGE_OPERATION_CONFLICT',
          'File batch ID was already accepted with different content',
        );
      return value.receipt;
    }
    if (
      this.db.prepare('SELECT 1 FROM file_change_batches WHERE id=?').get(id) !== undefined ||
      operation(this.db, id) !== undefined
    )
      throw new StorageError(
        'FILE_CHANGE_OPERATION_CONFLICT',
        'File operation ID belongs to another operation',
      );
    return undefined;
  }
  public getBatch(sessionId: string, id: string): FileChangeBatchReceipt {
    traceSession(this.db, sessionId);
    const value = batch(this.db, sessionId, id);
    if (value === undefined)
      throw new StorageError('FILE_OPERATION_NOT_FOUND', 'File restoration batch does not exist');
    return value.receipt;
  }
  public updateBatchItem(
    sessionId: string,
    id: string,
    item: FileChangeBatchItem,
    at: number,
  ): FileChangeBatchReceipt {
    checked(FileChangeBatchItemSchema, item);
    const current = this.getBatch(sessionId, id);
    if (
      isDeepStrictEqual(
        current.items.find((value) => value.changeId === item.changeId),
        item,
      )
    )
      return current;
    this.event(sessionId, 'file.batch.item', { operationId: id, item }, null, at);
    return this.getBatch(sessionId, id);
  }
  public finishBatch(
    sessionId: string,
    id: string,
    status: FileChangeBatchReceipt['status'],
    error: string | null,
    at: number,
  ): FileChangeBatchReceipt {
    const current = this.getBatch(sessionId, id);
    if (!activeBatch(current)) {
      if (current.status === status && current.error === error) return current;
      throw new StorageError('CONFLICT', 'File batch already has a different terminal result');
    }
    this.event(sessionId, 'file.batch.finished', { operationId: id, status, error }, null, at);
    return this.getBatch(sessionId, id);
  }
  public cancelBatch(sessionId: string, id: string, at: number): FileChangeBatchReceipt {
    const current = this.getBatch(sessionId, id);
    if (current.cancelRequested || !activeBatch(current)) return current;
    this.event(sessionId, 'file.batch.cancel_requested', { operationId: id }, null, at);
    return this.getBatch(sessionId, id);
  }
  public listBatches(sessionId: string, query: FileChangeBatchQuery = {}): FileChangeBatchPage {
    traceSession(this.db, sessionId);
    checked(FileChangeBatchQuerySchema, query);
    const limit = query.limit ?? 25;
    const rows = this.db
      .prepare(
        'SELECT id,seq FROM file_change_batches WHERE session_id=? AND seq<? ORDER BY seq DESC LIMIT ?',
      )
      .all(sessionId, query.cursor ?? Number.MAX_SAFE_INTEGER, limit + 1)
      .map((row) => checked(idRow, row));
    const items = rows.slice(0, limit).map((row) => {
      const { items, ...receipt } = this.getBatch(sessionId, row.id);
      return {
        ...receipt,
        itemCount: items.length,
        appliedCount: items.filter((item) => item.status === 'applied').length,
        failedCount: items.filter(
          (item) =>
            item.status === 'conflict' ||
            item.status === 'not_applied' ||
            item.status === 'cancelled',
        ).length,
        unknownCount: items.filter((item) => item.status === 'unknown').length,
      };
    });
    return checked(FileChangeBatchPageSchema, {
      items,
      nextCursor: rows.length > limit ? (rows[limit - 1]?.seq ?? null) : null,
    });
  }
  public pendingBatches(limit = 50, cursor = 0): PendingFileBatches {
    this.pagination(limit, cursor);
    const rows = this.db
      .prepare(
        `SELECT b.rowid AS cursor,b.session_id,b.data FROM file_change_batches b JOIN sessions s ON s.id=b.session_id WHERE s.archived=0 AND b.rowid>? AND json_extract(b.data,'$.status') IN ('accepted','running') ORDER BY b.rowid LIMIT ?`,
      )
      .all(cursor, limit + 1)
      .map((row) => checked(pendingBatchRow, row));
    return {
      items: rows.slice(0, limit).map((row) => ({
        sessionId: row.session_id,
        receipt: checked(FileChangeBatchReceiptSchema, JSON.parse(row.data)),
      })),
      nextCursor: rows.length > limit ? (rows[limit - 1]?.cursor ?? null) : null,
    };
  }
  public references(): Set<string> {
    const refs = new Set<string>();
    for (const row of this.db
      .prepare('SELECT DISTINCT sha256,bytes FROM file_image_refs')
      .iterate())
      refs.add(checked(hashRow, row).sha256);
    return refs;
  }
  public validatePreparations(inputs: readonly EventInput[]): void {
    for (const input of inputs)
      if (input.type === 'file.operation.prepared') {
        const intent = checked(FileOperationIntentSchema, input.data);
        for (const image of [intent.before, intent.after]) if (image.exists) this.blobs.read(image);
      }
  }
  public validateImages(): void {
    for (const row of this.db
      .prepare('SELECT DISTINCT sha256,bytes FROM file_image_refs')
      .iterate())
      this.blobs.read(checked(hashRow, row));
  }
}
