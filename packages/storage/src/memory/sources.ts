import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  MessageViewSchema,
  SessionSummarySchema,
  type MemoryScope,
  type MemorySource,
  type MessageView,
} from '@my-pi-harness/protocol';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';

const JsonRowSchema = Type.Object({ data: Type.String() });

/** Read exact persistent root text in its currently selected branch; no live/private body is used. */
export function memorySource(
  sqlite: Database.Database,
  scope: MemoryScope,
  source: MemorySource,
): MessageView | null {
  if (source.kind === 'manual') return null;
  const sessionRow: unknown = sqlite
    .prepare('SELECT data FROM sessions WHERE id=? AND archived=0')
    .get(source.sessionId);
  if (sessionRow === undefined) sourceConflict('Memory source session is unavailable');
  const session = checked(
    SessionSummarySchema,
    JSON.parse(checked(JsonRowSchema, sessionRow).data),
  );
  if (
    session.activeBranchId !== source.branchId ||
    (scope.kind === 'workspace' && session.workspaceId !== scope.workspaceId)
  )
    sourceConflict('Memory source is outside the selected branch or workspace');
  const row: unknown = sqlite
    .prepare(
      `SELECT m.data FROM messages m
    JOIN branch_messages bm ON bm.message_id=m.id JOIN branches b ON b.id=bm.branch_id
    WHERE m.id=? AND m.session_id=? AND bm.branch_id=? AND b.session_id=?
    AND NOT EXISTS(SELECT 1 FROM task_messages tm WHERE tm.message_id=m.id)`,
    )
    .get(source.messageId, source.sessionId, source.branchId, source.sessionId);
  if (row === undefined) sourceConflict('Memory source message is unavailable');
  const message = checked(MessageViewSchema, JSON.parse(checked(JsonRowSchema, row).data));
  if (
    message.status === 'streaming' ||
    message.agentMessageId !== undefined ||
    hash(message.text) !== source.contentHash
  )
    sourceConflict('Memory source text changed or is not a saved root message');
  return message;
}

export function memorySourceFingerprint(source: MemorySource): string {
  return hash(
    JSON.stringify(
      source.kind === 'manual'
        ? { kind: 'manual' }
        : {
            kind: 'message',
            sessionId: source.sessionId,
            branchId: source.branchId,
            messageId: source.messageId,
            contentHash: source.contentHash,
          },
    ),
  );
}

/** Forget suppresses every saved source, including sources replaced by later corrections. */
export function memorySourceForgotten(
  sqlite: Database.Database,
  owner: string,
  fingerprint: string,
): boolean {
  return (
    sqlite
      .prepare(
        `SELECT 1 FROM memory_suppressions forgotten
    LEFT JOIN memory_entry_sources source ON source.owner_user_id=forgotten.owner_user_id AND source.memory_id=forgotten.memory_id
    WHERE forgotten.owner_user_id=? AND (forgotten.source_fingerprint=? OR source.source_fingerprint=?) LIMIT 1`,
      )
      .get(owner, fingerprint, fingerprint) !== undefined
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceConflict(message: string): never {
  throw new StorageError('CONFLICT', message);
}
