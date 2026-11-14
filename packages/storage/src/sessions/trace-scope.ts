import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  SessionSummarySchema,
  type SessionSummary,
  type UsageQuery,
  type TraceQuery,
} from '@my-pi-harness/protocol';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';

export interface ExecutionFilter {
  sql: string[];
  parameters: (string | number)[];
}
const dataRow = Type.Object({ data: Type.String() });

/** Versions above the frozen cursor never affect status filtering or set membership. */
export const latestTraceVersion =
  'NOT EXISTS (SELECT 1 FROM trace_entries n WHERE n.session_id=t.session_id AND n.id=t.id AND n.version_seq>t.version_seq AND n.version_seq<=?)';

/** Resolve only a visible session before reading private execution indexes. */
export function traceSession(db: Database.Database, sessionId: string): SessionSummary {
  const row: unknown = db
    .prepare('SELECT data FROM sessions WHERE id=? AND archived=0')
    .get(sessionId);
  if (row === undefined)
    throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
  return checked(SessionSummarySchema, JSON.parse(checked(dataRow, row).data));
}

/** Shared exact branch/Run/task predicates; task descendants are authorized by the same session. */
export function executionFilter(
  db: Database.Database,
  sessionId: string,
  query: TraceQuery | UsageQuery,
): ExecutionFilter {
  const filter: ExecutionFilter = { sql: [], parameters: [] };
  if (query.branchId !== undefined) {
    filter.sql.push('t.branch_id=?');
    filter.parameters.push(query.branchId);
  }
  if (query.runId !== undefined) {
    if (query.includeDescendants === true) {
      filter.sql.push(`t.run_id IN (WITH RECURSIVE descendants(id) AS (
        SELECT id FROM runs WHERE session_id=? AND id=? UNION
        SELECT child_run.id FROM runs child_run JOIN agent_tasks child ON child.id=child_run.task_id
        JOIN descendants parent ON child.parent_run_id=parent.id WHERE child_run.session_id=?) SELECT id FROM descendants)`);
      filter.parameters.push(sessionId, query.runId, sessionId);
    } else {
      filter.sql.push('t.run_id=?');
      filter.parameters.push(query.runId);
    }
  }
  if (query.taskId !== undefined) {
    const found: unknown = db
      .prepare('SELECT id FROM agent_tasks WHERE session_id=? AND id=?')
      .get(sessionId, query.taskId);
    if (found === undefined)
      throw new StorageError('TRACE_NOT_FOUND', 'Trace task does not belong to this session');
    if (query.includeDescendants === false) {
      filter.sql.push('t.task_id=?');
      filter.parameters.push(query.taskId);
    } else {
      filter.sql.push(`t.task_id IN (WITH RECURSIVE descendants(id) AS (
        SELECT id FROM agent_tasks WHERE session_id=? AND id=? UNION
        SELECT child.id FROM agent_tasks child JOIN runs parent ON parent.id=child.parent_run_id
        JOIN descendants d ON parent.task_id=d.id WHERE child.session_id=?) SELECT id FROM descendants)`);
      filter.parameters.push(sessionId, query.taskId, sessionId);
    }
  }
  return filter;
}
