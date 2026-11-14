import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  FileOperationRecordSchema,
  FileChangeRecordSchema,
  FileChangeHeadSchema,
  type FileOperationRecord,
  type FileChangeRecord,
  type FileChangeHead,
} from '@my-pi-harness/protocol/internal';
import { StorageError } from '../../shared/errors';
import { checked } from '../../shared/validation';

const dataRow = Type.Object({ data: Type.String() });
export const fileSourceRow = Type.Object({
  tool_call_id: Type.Union([Type.String(), Type.Null()]),
  answer_input_message_id: Type.Union([Type.String(), Type.Null()]),
  task_id: Type.Union([Type.String(), Type.Null()]),
});

export function operation(db: Database.Database, id: string): FileOperationRecord | undefined {
  const row: unknown = db.prepare('SELECT data FROM file_operations WHERE id=?').get(id);
  return row === undefined
    ? undefined
    : checked(FileOperationRecordSchema, JSON.parse(checked(dataRow, row).data));
}

export function change(db: Database.Database, id: string): FileChangeRecord | undefined {
  const row: unknown = db.prepare('SELECT data FROM file_changes WHERE id=?').get(id);
  return row === undefined
    ? undefined
    : checked(FileChangeRecordSchema, JSON.parse(checked(dataRow, row).data));
}

export function head(db: Database.Database, targetKey: string): FileChangeHead {
  const row: unknown = db
    .prepare('SELECT data FROM file_change_heads WHERE target_key=?')
    .get(targetKey);
  return row === undefined
    ? {
        targetKey,
        revision: 0,
        headChangeId: null,
        redoTopChangeId: null,
        redoEpoch: null,
        pendingOperationId: null,
        uncertainOperationId: null,
      }
    : checked(FileChangeHeadSchema, JSON.parse(checked(dataRow, row).data));
}

export function saveHead(db: Database.Database, value: FileChangeHead): void {
  checked(FileChangeHeadSchema, value);
  db.prepare(
    'INSERT INTO file_change_heads(target_key,data) VALUES(?,?) ON CONFLICT(target_key) DO UPDATE SET data=excluded.data',
  ).run(value.targetKey, JSON.stringify(value));
}

export function saveOperation(db: Database.Database, value: FileOperationRecord): void {
  checked(FileOperationRecordSchema, value);
  db.prepare('UPDATE file_operations SET data=? WHERE id=?').run(
    JSON.stringify(value),
    value.intent.operationId,
  );
}

export function saveChange(db: Database.Database, value: FileChangeRecord): void {
  checked(FileChangeRecordSchema, value);
  db.prepare('UPDATE file_changes SET data=? WHERE id=?').run(
    JSON.stringify(value),
    value.operation.intent.operationId,
  );
}

export function requireOperation(
  db: Database.Database,
  sessionId: string,
  id: string,
): FileOperationRecord {
  const value = operation(db, id);
  if (value === undefined || value.sessionId !== sessionId)
    throw new StorageError(
      'FILE_OPERATION_NOT_FOUND',
      'File operation does not belong to this conversation',
    );
  return value;
}

export function requireChange(
  db: Database.Database,
  sessionId: string,
  id: string,
): FileChangeRecord {
  const value = change(db, id);
  if (value === undefined || value.operation.sessionId !== sessionId)
    throw new StorageError(
      'FILE_CHANGE_NOT_FOUND',
      'File change does not belong to this conversation',
    );
  return value;
}
