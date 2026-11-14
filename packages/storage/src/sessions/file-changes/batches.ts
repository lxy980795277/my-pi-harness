import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';
import {
  FileChangeBatchReceiptSchema,
  FileChangeBatchItemSchema,
  type FileChangeBatchReceipt,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import { StorageError } from '../../shared/errors';
import { checked } from '../../shared/validation';
import { requireChange, requireOperation } from './records';

export interface BatchRow {
  seq: number;
  requestHash: string;
  receipt: FileChangeBatchReceipt;
}
const rowSchema = Type.Object({
  seq: Type.Integer(),
  request_hash: Type.String(),
  data: Type.String(),
});
const acceptedHost = Type.Object(
  { requestHash: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
  { additionalProperties: false },
);
const operationIdSchema = Type.Object(
  { operationId: Type.String() },
  { additionalProperties: true },
);
const idSchema = Type.Object({ operationId: Type.String() }, { additionalProperties: false });
const itemSchema = Type.Object(
  { operationId: Type.String(), item: FileChangeBatchItemSchema },
  { additionalProperties: false },
);
const finishedSchema = Type.Object(
  {
    operationId: Type.String(),
    status: FileChangeBatchReceiptSchema.properties.status,
    error: FileChangeBatchReceiptSchema.properties.error,
  },
  { additionalProperties: false },
);
const terminalItems = new Set(['applied', 'not_applied', 'conflict', 'unknown', 'cancelled']);

export function activeBatch(receipt: FileChangeBatchReceipt): boolean {
  return receipt.status === 'accepted' || receipt.status === 'running';
}

export function batch(db: Database.Database, sessionId: string, id: string): BatchRow | undefined {
  const value: unknown = db
    .prepare('SELECT seq,request_hash,data FROM file_change_batches WHERE session_id=? AND id=?')
    .get(sessionId, id);
  if (value === undefined) return undefined;
  const row = checked(rowSchema, value);
  return {
    seq: row.seq,
    requestHash: row.request_hash,
    receipt: checked(FileChangeBatchReceiptSchema, JSON.parse(row.data)),
  };
}

/** Batch receipts record progress and cancellation; they never publish workspace bytes. */
export class FileChangeBatchProjection {
  public constructor(private readonly db: Database.Database) {}
  public apply(event: HarnessEvent, privateData: Record<string, unknown> | undefined): void {
    if (event.runId !== null)
      throw new StorageError(
        'INVALID_RECORD',
        'User file restoration batches do not belong to model runs',
      );
    if (event.type === 'file.batch.accepted') {
      const receipt = checked(FileChangeBatchReceiptSchema, event.data);
      const host = checked(acceptedHost, privateData?.['fileBatchHost']);
      if (
        receipt.status !== 'accepted' ||
        receipt.createdAt !== event.at ||
        receipt.updatedAt !== event.at ||
        receipt.finishedAt !== null ||
        receipt.cancelRequested ||
        receipt.error !== null ||
        new Set(receipt.items.map((item) => item.changeId)).size !== receipt.items.length
      )
        throw new StorageError('INVALID_RECORD', 'Initial file batch receipt is invalid');
      for (const item of receipt.items) {
        const original = requireChange(this.db, event.sessionId, item.changeId);
        if (
          item.path !== original.operation.intent.path ||
          item.status !== 'not_started' ||
          item.fileOperationId !== null ||
          item.error !== null
        )
          throw new StorageError('INVALID_RECORD', 'Initial file batch item is invalid');
      }
      this.db
        .prepare(
          'INSERT INTO file_change_batches(id,session_id,seq,request_hash,data) VALUES(?,?,?,?,?)',
        )
        .run(
          receipt.operationId,
          event.sessionId,
          event.seq,
          host.requestHash,
          JSON.stringify(receipt),
        );
      return;
    }
    if (
      !['file.batch.item', 'file.batch.finished', 'file.batch.cancel_requested'].includes(
        event.type,
      )
    )
      throw new StorageError('INVALID_EVENT', 'Unknown file restoration batch event');
    const input = checked(operationIdSchema, event.data);
    const current = batch(this.db, event.sessionId, input.operationId);
    if (current === undefined)
      throw new StorageError('FILE_OPERATION_NOT_FOUND', 'File restoration batch does not exist');
    if (!activeBatch(current.receipt))
      throw new StorageError('CONFLICT', 'File restoration batch is already settled');
    let receipt: FileChangeBatchReceipt = { ...current.receipt, updatedAt: event.at };
    if (event.type === 'file.batch.item') {
      const input = checked(itemSchema, event.data);
      const previous = receipt.items.find((item) => item.changeId === input.item.changeId);
      if (
        previous === undefined ||
        previous.path !== input.item.path ||
        (terminalItems.has(previous.status) && !isDeepStrictEqual(previous, input.item))
      )
        throw new StorageError(
          'CONFLICT',
          'File batch item cannot change its identity or terminal result',
        );
      if (
        (input.item.status === 'applied' || input.item.status === 'running') &&
        input.item.fileOperationId === null
      )
        throw new StorageError(
          'INVALID_RECORD',
          'Executing file batch items require their durable publication',
        );
      if (input.item.fileOperationId !== null) {
        const operation = requireOperation(this.db, event.sessionId, input.item.fileOperationId);
        if (
          operation.intent.targetChangeId !== input.item.changeId ||
          operation.intent.action !== receipt.action ||
          (input.item.status === 'applied' && operation.status !== 'applied') ||
          (input.item.status === 'running' && operation.status !== 'prepared') ||
          (input.item.status === 'not_applied' && operation.status !== 'not_applied') ||
          (input.item.status === 'unknown' &&
            operation.status !== 'unknown' &&
            operation.status !== 'prepared')
        )
          throw new StorageError(
            'INVALID_RECORD',
            'File batch item references a different publication',
          );
      }
      receipt = {
        ...receipt,
        status: 'running',
        items: receipt.items.map((item) =>
          item.changeId === input.item.changeId ? input.item : item,
        ),
      };
    } else if (event.type === 'file.batch.finished') {
      const input = checked(finishedSchema, event.data);
      if (
        input.status === 'accepted' ||
        input.status === 'running' ||
        receipt.items.some((item) => item.status === 'running') ||
        (input.status === 'completed' && receipt.items.some((item) => item.status !== 'applied'))
      )
        throw new StorageError(
          'CONFLICT',
          'File restoration batch cannot finish with running or incomplete results',
        );
      receipt = { ...receipt, status: input.status, error: input.error, finishedAt: event.at };
    } else {
      checked(idSchema, event.data);
      receipt = { ...receipt, cancelRequested: true };
    }
    checked(FileChangeBatchReceiptSchema, receipt);
    this.db
      .prepare('UPDATE file_change_batches SET data=? WHERE id=?')
      .run(JSON.stringify(receipt), receipt.operationId);
  }
}
