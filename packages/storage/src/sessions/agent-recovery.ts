import { asc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ToolCallRecordSchema, type SessionSummary } from '@my-pi-harness/protocol';
import type { EventInput } from './types.js';
import * as schema from '../sqlite/schema.js';
import { checked } from '../shared/validation.js';
import { interruptionEvents } from './interruption.js';
import { ToolProjection } from './projections/tools.js';
import { WorkRepository } from './projections/work.js';

/** Settle abandoned trees from the leaves upward without repeating model or tool effects. */
export function agentInterruptionEvents(
  db: BetterSQLite3Database<typeof schema>,
  session: SessionSummary,
  at: number,
): EventInput[] {
  const tools = new ToolProjection(db);
  const work = new WorkRepository(db);
  const runs = db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.sessionId, session.id))
    .orderBy(asc(schema.runs.id))
    .all();
  const toolEvents = runs.flatMap(({ id }) => tools.recovery(session.id, id, at));
  const rootEvents = interruptionEvents(
    session,
    work.interruptedStates(session.id),
    toolEvents,
    at,
  );
  const terminal = rootEvents.filter((event) => event.type === 'run.finished');
  const events = rootEvents.filter((event) => event.type !== 'run.finished');
  for (const { taskId, state } of work.interruptedTaskStates(session.id)) {
    events.push({
      type: 'work.updated',
      runId: null,
      at,
      data: {
        taskId,
        state: {
          ...state,
          revision: state.revision + 1,
          plan:
            state.plan?.review === 'pending'
              ? { ...state.plan, review: 'interrupted' }
              : state.plan,
          questions: state.questions.map((question) =>
            question.status === 'pending' ? { ...question, status: 'interrupted' } : question,
          ),
        },
      },
    });
  }
  for (const row of db
    .select()
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.sessionId, session.id))
    .all()) {
    if (row.data.status === 'queued')
      events.push({
        type: 'task.message_undelivered',
        runId: null,
        at,
        data: { messageId: row.id, reason: 'Daemon stopped before this message was consumed' },
      });
  }
  const tasks = db
    .select()
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.sessionId, session.id))
    .orderBy(sql`rowid DESC`)
    .all();
  for (const task of tasks) {
    if (task.closedAt !== null) continue;
    for (const run of runs.filter(
      (row) => row.taskId === task.id && row.data.status === 'running',
    )) {
      const unknown = toolEvents.some(
        (event) =>
          event.runId === run.id &&
          event.type === 'tool.updated' &&
          checked(ToolCallRecordSchema, event.data['tool']).status === 'unknown',
      );
      events.push({
        type: 'run.finished',
        runId: run.id,
        at,
        data: {
          status: unknown ? 'failed' : 'interrupted',
          finishedAt: at,
          error: 'Daemon stopped before a durable terminal outcome',
        },
      });
    }
    events.push({
      type: 'task.closed',
      runId: null,
      at,
      data: {
        taskId: task.id,
        reason: 'interrupted',
        closedAt: at,
        error: 'Task owner stopped before closing this task',
      },
    });
  }
  return [...events, ...terminal];
}
