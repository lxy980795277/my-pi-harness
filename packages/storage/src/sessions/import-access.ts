import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  SessionExecutionAccessSchema,
  SessionArchiveImportBindingSchema,
  type SessionExecutionAccess,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';

const accessRow = Type.Object({
  imported_through_seq: Type.Integer({ minimum: 0 }),
  bound: Type.Integer({ minimum: 0, maximum: 1 }),
});
const seal = Type.Object(
  {
    operationId: Type.String(),
    archiveSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    importedThroughSeq: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
const owner = Type.Object(
  { userId: Type.Union([Type.String(), Type.Null()]) },
  { additionalProperties: false },
);

export function sessionExecutionAccess(
  db: Database.Database,
  sessionId: string,
): SessionExecutionAccess {
  const row: unknown = db
    .prepare('SELECT imported_through_seq,bound FROM session_import_access WHERE session_id=?')
    .get(sessionId);
  if (row === undefined) return { importedThroughSeq: null, bound: true };
  const value = checked(accessRow, row);
  return checked(SessionExecutionAccessSchema, {
    importedThroughSeq: value.imported_through_seq,
    bound: value.bound === 1,
  });
}

/** Host import seals revoke historical execution authority while retaining transcript facts. */
export function projectImportAccess(
  db: Database.Database,
  event: HarnessEvent,
  privateData: Record<string, unknown> | undefined,
): void {
  if (event.type === 'session.imported') {
    const data = checked(seal, event.data);
    const host = checked(owner, privateData?.['importOwner']);
    if (event.runId !== null || data.importedThroughSeq >= event.seq)
      throw new StorageError('INVALID_RECORD', 'Import seal must follow the frozen history');
    db.prepare('UPDATE sessions SET archived=0 WHERE id=?').run(event.sessionId);
    db.prepare(
      'INSERT INTO session_import_access(session_id,imported_through_seq,bound,owner_user_id,data) VALUES(?,?,0,?,?) ON CONFLICT(session_id) DO UPDATE SET imported_through_seq=excluded.imported_through_seq,bound=0,owner_user_id=excluded.owner_user_id,data=excluded.data',
    ).run(event.sessionId, data.importedThroughSeq, host.userId, JSON.stringify(data));
  } else if (event.type === 'session.execution_bound') {
    checked(SessionArchiveImportBindingSchema, event.data);
    if (
      event.runId !== null ||
      sessionExecutionAccess(db, event.sessionId).importedThroughSeq === null
    )
      throw new StorageError('INVALID_RECORD', 'Execution binding requires imported history');
    db.prepare('UPDATE session_import_access SET bound=1 WHERE session_id=?').run(event.sessionId);
  }
}
