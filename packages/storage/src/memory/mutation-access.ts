import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  RunViewSchema,
  SessionSummarySchema,
  ToolCallRecordSchema,
  MemorySaveInputSchema,
  MemoryAgentUpdateInputSchema,
  MemoryAgentDeleteInputSchema,
  type MemoryScope,
  type MemorySaveInput,
  type MemoryAgentUpdateInput,
  type MemoryAgentDeleteInput,
} from '@my-pi-harness/protocol';
import {
  normalizeMemorySave,
  normalizeMemoryUpdate,
  normalizeMemoryDelete,
  memoryMutationFingerprint,
  type MemoryAgentMutationRecord,
} from '@my-pi-harness/memory';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import { memorySource, memorySourceFingerprint, memorySourceForgotten } from './sources';

const JsonRowSchema = Type.Object({ data: Type.String() });
const ToolRowSchema = Type.Object({ data: Type.String(), anchor_message_id: Type.String() });
const ContextMarkerSchema = Type.Object({ marker: Type.Union([Type.String(), Type.Null()]) });
const IdSchema = Type.Object({ id: Type.String() });

/** Writes require the actual consumed root input and the matching durable assistant tool intent. */
export function assertMemoryMutationAccess(
  sqlite: Database.Database,
  record: MemoryAgentMutationRecord,
  targetScope?: MemoryScope,
): MemoryScope {
  const { access } = record;
  const sessionRow = sqlite
    .prepare('SELECT data FROM sessions WHERE id=? AND archived=0')
    .get(access.sessionId);
  const runRow = sqlite
    .prepare('SELECT data FROM runs WHERE id=? AND session_id=?')
    .get(access.runId, access.sessionId);
  if (sessionRow === undefined || runRow === undefined) conflict('Memory execution is unavailable');
  const session = checked(
    SessionSummarySchema,
    JSON.parse(checked(JsonRowSchema, sessionRow).data),
  );
  const run = checked(RunViewSchema, JSON.parse(checked(JsonRowSchema, runRow).data));
  if (
    run.taskId !== undefined ||
    run.status !== 'running' ||
    session.activeRunId !== run.id ||
    session.activeBranchId !== access.branchId ||
    run.branchId !== access.branchId ||
    access.source.sessionId !== session.id ||
    access.source.branchId !== access.branchId
  )
    conflict('Only the active root run may write memories');
  if (
    sqlite
      .prepare(
        "SELECT 1 FROM events WHERE session_id=? AND run_id=? AND type='run.cancel_requested'",
      )
      .get(session.id, run.id)
  )
    conflict('Memory execution was cancelled');
  let scope = targetScope;
  if (record.operation === 'save' || record.operation === 'learn') {
    if (record.input.scope === 'user') scope = { kind: 'user' };
    else {
      if (session.workspaceId === null) conflict('Workspace memory requires the current workspace');
      scope = { kind: 'workspace', workspaceId: session.workspaceId };
    }
  }
  if (
    scope === undefined ||
    (scope.kind === 'workspace' && scope.workspaceId !== session.workspaceId)
  )
    conflict('Memory is outside the current workspace');
  const source = memorySource(sqlite, scope, access.source);
  if (!source || source.role !== 'user' || source.runId !== run.id || !source.text.trim())
    conflict('Memory writes require a consumed direct user input');
  const latest = sqlite
    .prepare(
      `SELECT m.id FROM messages m JOIN branch_messages bm ON bm.message_id=m.id
    WHERE m.session_id=? AND bm.branch_id=? AND json_extract(m.data,'$.runId')=?
    AND json_extract(m.data,'$.role')='user' AND json_type(m.data,'$.agentMessageId') IS NULL
    AND NOT EXISTS(SELECT 1 FROM task_messages tm WHERE tm.message_id=m.id) ORDER BY bm.ordinal DESC LIMIT 1`,
    )
    .get(session.id, access.branchId, run.id);
  if (latest === undefined || checked(IdSchema, latest).id !== source.id)
    conflict('Memory writes require the latest consumed direct user input');
  if (
    record.operation === 'learn' &&
    sqlite
      .prepare(
        "SELECT 1 FROM messages WHERE id=? AND session_id=? AND json_array_length(private_data,'$.searchQuotes')>0",
      )
      .get(source.id, session.id)
  )
    conflict('Quoted search material is not automatic learning evidence');
  if (
    record.operation !== 'delete' &&
    memorySourceForgotten(sqlite, access.ownerUserId, memorySourceFingerprint(access.source))
  )
    conflict('This source was forgotten; save a new memory manually to restore it');
  assertAfterContextReset(sqlite, session.id, access.branchId, source.id);
  const toolRow = sqlite
    .prepare(
      'SELECT data,anchor_message_id FROM tool_calls WHERE id=? AND session_id=? AND run_id=?',
    )
    .get(access.toolCallId, session.id, run.id);
  if (toolRow === undefined) conflict('Memory tool intent is unavailable');
  const intentRow = checked(ToolRowSchema, toolRow);
  const tool = checked(ToolCallRecordSchema, JSON.parse(intentRow.data));
  if (tool.name !== `${record.operation}_memory` || tool.status !== 'running')
    conflict('Memory tool is no longer executing');
  if (
    !sqlite
      .prepare(
        `SELECT 1 FROM events consumed JOIN events assistant ON assistant.session_id=consumed.session_id AND assistant.run_id=consumed.run_id
    WHERE consumed.session_id=? AND consumed.run_id=? AND consumed.type='message.started' AND json_extract(consumed.data,'$.id')=?
    AND assistant.type='message.started' AND json_extract(assistant.data,'$.id')=? AND consumed.seq<=assistant.seq`,
      )
      .get(session.id, run.id, source.id, intentRow.anchor_message_id)
  )
    conflict('Memory tool intent preceded its consumed input');
  const input = recordedInput(record.operation, tool.arguments);
  if (record.fingerprint !== memoryMutationFingerprint(record.operation, access.source, input))
    conflict('Memory write differs from the recorded tool intent');
  return scope;
}

function recordedInput(
  operation: MemoryAgentMutationRecord['operation'],
  value: unknown,
): MemorySaveInput | MemoryAgentUpdateInput | MemoryAgentDeleteInput {
  switch (operation) {
    case 'save':
    case 'learn':
      return normalizeMemorySave(checked(MemorySaveInputSchema, value), operation);
    case 'update':
      return normalizeMemoryUpdate(checked(MemoryAgentUpdateInputSchema, value));
    case 'delete':
      return normalizeMemoryDelete(checked(MemoryAgentDeleteInputSchema, value));
  }
}

function assertAfterContextReset(
  sqlite: Database.Database,
  sessionId: string,
  branchId: string,
  messageId: string,
): void {
  const row = sqlite
    .prepare(
      "SELECT json_extract(data,'$.contextStartAfterMessageId') AS marker FROM work_states WHERE session_id=? AND branch_id=?",
    )
    .get(sessionId, branchId);
  const marker = row === undefined ? null : checked(ContextMarkerSchema, row).marker;
  if (
    marker !== null &&
    !sqlite
      .prepare(
        `SELECT 1 FROM branch_messages input JOIN branch_messages boundary ON boundary.branch_id=input.branch_id
    WHERE input.branch_id=? AND input.message_id=? AND boundary.message_id=? AND input.ordinal>boundary.ordinal`,
      )
      .get(branchId, messageId, marker)
  )
    conflict('Memory input precedes the current context reset');
}

function conflict(message: string): never {
  throw new StorageError('CONFLICT', message);
}
