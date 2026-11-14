import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';
import { ToolCallRecordSchema, type HarnessEvent } from '@my-pi-harness/protocol';
import {
  FileOperationIntentSchema,
  FileOperationRecordSchema,
  FileOperationHostSchema,
  FileOperationPrepareSchema,
  FileOperationOutcomeSchema,
  FileOperationObservationSchema,
  type FileOperationRecord,
  type FileOperationPrepare,
} from '@my-pi-harness/protocol/internal';
import { StorageError } from '../../shared/errors';
import { checked } from '../../shared/validation';
import {
  head,
  change,
  operation,
  saveHead,
  saveOperation,
  saveChange,
  requireOperation,
} from './records';
import { FileChangeBatchProjection } from './batches';

const nullableId = Type.Union([Type.String(), Type.Null()]);
const sourceRow = Type.Object({
  run_id: Type.String(),
  data: Type.String(),
  task_id: nullableId,
  answer_input_message_id: nullableId,
});
const dataRow = Type.Object({ data: Type.String() });
const branchRow = Type.Object({ workspace_id: nullableId });
const completedSchema = Type.Object(
  { operationId: Type.String(), outcome: FileOperationOutcomeSchema },
  { additionalProperties: false },
);
const observedSchema = Type.Object(
  { operationId: Type.String(), observation: FileOperationObservationSchema },
  { additionalProperties: false },
);

/** File history records disk outcomes independently from the source tool's eventual status. */
export class FileChangeProjection {
  private rebuilding = false;
  private readonly batches: FileChangeBatchProjection;
  public constructor(private readonly db: Database.Database) {
    this.batches = new FileChangeBatchProjection(db);
  }

  public clear(): void {
    this.rebuilding = true;
    this.db.exec(
      'DELETE FROM file_operations; DELETE FROM file_changes; DELETE FROM file_change_heads; DELETE FROM file_image_refs; DELETE FROM file_change_batches;',
    );
  }

  /** Cross-conversation target revisions determine disk history order, not journal filename order. */
  public finishRebuild(): void {
    let target = '',
      revision = -1,
      id = '';
    for (;;) {
      const rows = this.db
        .prepare(
          `SELECT data FROM file_operations
        WHERE target_key>? OR target_key=? AND expected_revision>? OR target_key=? AND expected_revision=? AND id>?
        ORDER BY target_key,expected_revision,id LIMIT 200`,
        )
        .all(target, target, revision, target, revision, id);
      if (rows.length === 0) break;
      for (const row of rows) {
        const record = checked(FileOperationRecordSchema, JSON.parse(checked(dataRow, row).data));
        this.assertHead(record.intent);
        this.applyHead(record);
        target = record.intent.targetKey;
        revision = record.intent.expectedRevision;
        id = record.intent.operationId;
      }
    }
    this.rebuilding = false;
  }

  private assertHead(input: FileOperationPrepare): void {
    if (input.local === false) {
      if (input.action === 'write') return;
      const original =
        input.targetChangeId === null ? undefined : change(this.db, input.targetChangeId);
      if (original === undefined || original.operation.status !== 'applied')
        throw new StorageError(
          'INVALID_RECORD',
          'Imported restoration has no confirmed original change',
        );
      const before =
        input.action === 'undo'
          ? original.operation.intent.after
          : original.operation.intent.before;
      const after =
        input.action === 'undo'
          ? original.operation.intent.before
          : original.operation.intent.after;
      if (!isDeepStrictEqual(input.before, before) || !isDeepStrictEqual(input.after, after))
        throw new StorageError(
          'INVALID_RECORD',
          'Imported restoration images differ from the original change',
        );
      return;
    }
    const value = head(this.db, input.targetKey);
    if (value.revision !== input.expectedRevision || value.pendingOperationId !== null)
      throw new StorageError(
        'CONFLICT',
        'The file history changed or another publication is unresolved',
      );
    if (input.action === 'write') return;
    const target =
      input.targetChangeId === null ? undefined : change(this.db, input.targetChangeId);
    if (
      target === undefined ||
      (!this.rebuilding && !target.local) ||
      target.operation.status !== 'applied' ||
      target.operation.intent.targetKey !== input.targetKey ||
      value.uncertainOperationId !== null
    )
      throw new StorageError(
        'CONFLICT',
        'This file change cannot be restored from the current history',
      );
    const valid =
      input.action === 'undo'
        ? value.headChangeId === input.targetChangeId && target.applied
        : value.redoTopChangeId === input.targetChangeId &&
          !target.applied &&
          target.redoEpoch === value.redoEpoch;
    if (!valid)
      throw new StorageError('CONFLICT', 'File changes must be restored in history order');
    const before =
      input.action === 'undo' ? target.operation.intent.after : target.operation.intent.before;
    const after =
      input.action === 'undo' ? target.operation.intent.before : target.operation.intent.after;
    if (!isDeepStrictEqual(input.before, before) || !isDeepStrictEqual(input.after, after))
      throw new StorageError(
        'INVALID_RECORD',
        'Restore images do not match the original file change',
      );
  }

  private prepare(event: HarnessEvent, privateData: Record<string, unknown> | undefined): void {
    const intent = checked(FileOperationIntentSchema, event.data);
    const host = checked(FileOperationHostSchema, privateData?.['fileOperationHost']);
    const input = checked(FileOperationPrepareSchema, { ...intent, ...host });
    if (operation(this.db, input.operationId) !== undefined)
      throw new StorageError('CONFLICT', 'File operation identity already exists');
    const branch: unknown = this.db
      .prepare(
        'SELECT s.workspace_id FROM branches b JOIN sessions s ON s.id=b.session_id WHERE b.id=? AND b.session_id=?',
      )
      .get(input.branchId, event.sessionId);
    if (branch === undefined || checked(branchRow, branch).workspace_id !== input.workspaceId)
      throw new StorageError(
        'INVALID_RECORD',
        'File operation workspace or branch does not belong to this conversation',
      );
    let taskId: string | null = null;
    let answerId: string | null = null;
    let toolCallId: string | null = null;
    if (input.source.kind === 'tool') {
      toolCallId = input.source.toolCallId;
      const row: unknown = this.db
        .prepare(
          `SELECT t.run_id,t.data,r.task_id,tm.answer_input_message_id FROM tool_calls t JOIN runs r ON r.id=t.run_id LEFT JOIN trace_tool_timings tm ON tm.tool_call_id=t.id WHERE t.id=? AND t.session_id=?`,
        )
        .get(toolCallId, event.sessionId);
      if (row === undefined)
        throw new StorageError('INVALID_RECORD', 'File operation source tool does not exist');
      const source = checked(sourceRow, row);
      const tool = checked(ToolCallRecordSchema, JSON.parse(source.data));
      if (
        event.runId !== source.run_id ||
        tool.branchId !== input.branchId ||
        tool.status !== 'running' ||
        tool.binding.kind !== 'accepted' ||
        tool.binding.source.kind !== 'workspace' ||
        !['write_file', 'edit_file'].includes(tool.name) ||
        input.action !== 'write' ||
        input.targetChangeId !== null
      )
        throw new StorageError(
          'INVALID_RECORD',
          'File publication requires its running native file tool',
        );
      taskId = source.task_id;
      answerId = source.answer_input_message_id;
    } else {
      if (event.runId !== null || input.action === 'write' || input.targetChangeId === null)
        throw new StorageError(
          'INVALID_RECORD',
          'User restoration requires an original change and no model run',
        );
      const original = change(this.db, input.targetChangeId);
      if (
        original === undefined ||
        original.operation.sessionId !== event.sessionId ||
        original.operation.intent.workspaceId !== input.workspaceId ||
        original.operation.intent.path !== input.path ||
        original.operation.intent.targetKey !== input.targetKey ||
        !isDeepStrictEqual(original.operation.intent.rootIdentity, input.rootIdentity)
      )
        throw new StorageError(
          'INVALID_RECORD',
          'File restoration changed the original change ownership or workspace identity',
        );
    }
    if (!this.rebuilding) this.assertHead(input);
    const record: FileOperationRecord = {
      sessionId: event.sessionId,
      runId: event.runId,
      seq: event.seq,
      createdAt: event.at,
      finishedAt: null,
      intent: input,
      status: 'prepared',
      outcome: null,
      observation: null,
    };
    this.db
      .prepare(
        'INSERT INTO file_operations(id,session_id,seq,target_key,expected_revision,data) VALUES(?,?,?,?,?,?)',
      )
      .run(
        input.operationId,
        event.sessionId,
        event.seq,
        input.targetKey,
        input.expectedRevision,
        JSON.stringify(record),
      );
    for (const image of [input.before, input.after])
      if (image.exists)
        this.db
          .prepare('INSERT OR IGNORE INTO file_image_refs(operation_id,sha256,bytes) VALUES(?,?,?)')
          .run(input.operationId, image.sha256, image.bytes);
    if (input.action === 'write')
      this.db
        .prepare(
          'INSERT INTO file_changes(id,session_id,seq,tool_call_id,answer_input_message_id,task_id,data) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          input.operationId,
          event.sessionId,
          event.seq,
          toolCallId,
          answerId,
          taskId,
          JSON.stringify({
            operation: record,
            applied: false,
            previousChangeId: null,
            redoNextChangeId: null,
            redoEpoch: null,
            local: host.local !== false,
          }),
        );
    if (!this.rebuilding)
      saveHead(this.db, {
        ...head(this.db, input.targetKey),
        pendingOperationId: input.operationId,
      });
  }

  private applyHead(record: FileOperationRecord): void {
    if (record.intent.local === false) {
      const input = record.intent;
      const current = head(this.db, input.targetKey);
      if (record.status === 'applied') {
        const target = change(
          this.db,
          input.action === 'write' ? input.operationId : (input.targetChangeId ?? ''),
        );
        if (target === undefined)
          throw new StorageError(
            'INVALID_RECORD',
            'Imported file operation has no original change',
          );
        saveChange(this.db, {
          ...target,
          ...(input.action === 'write' ? { operation: record } : {}),
          applied: input.action !== 'undo',
        });
      }
      saveHead(this.db, {
        ...current,
        revision:
          record.status === 'prepared' ? input.expectedRevision : input.expectedRevision + 1,
        headChangeId: null,
        redoTopChangeId: null,
        redoEpoch: null,
        pendingOperationId: record.status === 'prepared' ? input.operationId : null,
        uncertainOperationId: record.status === 'unknown' ? input.operationId : null,
      });
      return;
    }
    const input = record.intent;
    const value = head(this.db, input.targetKey);
    if (record.status === 'prepared') {
      saveHead(this.db, { ...value, pendingOperationId: input.operationId });
      return;
    }
    const next = { ...value, revision: input.expectedRevision + 1, pendingOperationId: null };
    if (record.status === 'unknown') next.uncertainOperationId = input.operationId;
    if (record.status === 'applied' && input.action === 'write') {
      const previous =
        value.headChangeId === null ? undefined : change(this.db, value.headChangeId);
      const connects =
        value.uncertainOperationId === null &&
        previous !== undefined &&
        previous.applied &&
        isDeepStrictEqual(previous.operation.intent.parentIdentity, input.parentIdentity) &&
        isDeepStrictEqual(previous.operation.intent.after, input.before);
      const current = change(this.db, input.operationId);
      if (current === undefined)
        throw new StorageError('INVALID_RECORD', 'Original file change is missing');
      saveChange(this.db, {
        ...current,
        operation: record,
        applied: true,
        previousChangeId: connects ? value.headChangeId : null,
      });
      Object.assign(next, {
        headChangeId: input.operationId,
        redoTopChangeId: null,
        redoEpoch: input.operationId,
        uncertainOperationId: null,
      });
    } else if (record.status === 'applied') {
      const target =
        input.targetChangeId === null ? undefined : change(this.db, input.targetChangeId);
      if (target === undefined)
        throw new StorageError('INVALID_RECORD', 'Original file change is missing');
      if (input.action === 'undo') {
        saveChange(this.db, {
          ...target,
          applied: false,
          redoNextChangeId: value.redoTopChangeId,
          redoEpoch: value.redoEpoch,
        });
        Object.assign(next, {
          headChangeId: target.previousChangeId,
          redoTopChangeId: input.targetChangeId,
        });
      } else {
        saveChange(this.db, { ...target, applied: true });
        Object.assign(next, {
          headChangeId: input.targetChangeId,
          redoTopChangeId: target.redoNextChangeId,
        });
      }
    }
    saveHead(this.db, next);
  }

  public apply(event: HarnessEvent, privateData: Record<string, unknown> | undefined): void {
    if (event.type.startsWith('file.batch.')) {
      this.batches.apply(event, privateData);
      return;
    }
    if (event.type === 'file.operation.prepared') {
      this.prepare(event, privateData);
      return;
    }
    if (event.type !== 'file.operation.completed' && event.type !== 'file.operation.observed')
      return;
    const data =
      event.type === 'file.operation.completed'
        ? checked(completedSchema, event.data)
        : checked(observedSchema, event.data);
    const before = requireOperation(this.db, event.sessionId, data.operationId);
    if (before.runId !== event.runId)
      throw new StorageError('INVALID_RECORD', 'File operation completion changed its source run');
    let record: FileOperationRecord;
    if ('outcome' in data) {
      if (before.status !== 'prepared')
        throw new StorageError('CONFLICT', 'File operation already has a terminal result');
      record = {
        ...before,
        status: data.outcome.status,
        outcome: data.outcome,
        finishedAt: event.at,
      };
    } else {
      if (before.status !== 'prepared' && before.status !== 'unknown')
        throw new StorageError(
          'CONFLICT',
          'Confirmed file results cannot be replaced by a recovery observation',
        );
      record = {
        ...before,
        status: 'unknown',
        observation: data.observation,
        finishedAt: before.finishedAt ?? event.at,
      };
    }
    saveOperation(this.db, record);
    if (record.intent.action === 'write') {
      const current = change(this.db, record.intent.operationId);
      if (current !== undefined) saveChange(this.db, { ...current, operation: record });
    }
    if (!this.rebuilding && before.status === 'prepared') this.applyHead(record);
  }
}
