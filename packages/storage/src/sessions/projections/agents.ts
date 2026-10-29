import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { RunViewSchema, type HarnessEvent, type RunView } from '@my-pi-harness/protocol';
import { checked } from '../../shared/validation.js';
import { StorageError } from '../../shared/errors.js';
import * as schema from '../../sqlite/schema.js';
import {
  TaskClosedSchema,
  TaskCreatedSchema,
  TaskMessageConsumedSchema,
  TaskMessageQueuedSchema,
  TaskMessageUndeliveredSchema,
  TaskWaitingSchema,
} from '../event-validation.js';
import { AgentTaskQuery } from '../agent-tasks.js';

/** Validates task relations and projects their small lifecycle facts in the session transaction. */
export class AgentTaskProjection {
  private readonly tasks: AgentTaskQuery;
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {
    this.tasks = new AgentTaskQuery(db);
  }

  private run(sessionId: string, runId: string): RunView {
    const row = this.db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
    if (!row || row.sessionId !== sessionId)
      throw new StorageError('INVALID_EVENT', 'Agent run does not belong to this session');
    return checked(RunViewSchema, row.data);
  }

  public root(sessionId: string, runId: string): string {
    const run = this.run(sessionId, runId);
    if (run.taskId === undefined) return run.id;
    return this.tasks.row(sessionId, run.taskId).rootRunId;
  }

  private actor(event: HarnessEvent, rootRunId: string): void {
    if (event.runId !== null && this.root(event.sessionId, event.runId) !== rootRunId)
      throw new StorageError('INVALID_EVENT', 'Task event actor is outside its execution tree');
  }

  public create(event: HarnessEvent): void {
    const { task } = checked(TaskCreatedSchema, event.data);
    const source = this.db
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, task.sourceToolCallId))
      .get();
    if (
      !source ||
      source.sessionId !== event.sessionId ||
      source.runId !== event.runId ||
      source.data.name !== 'spawn_agent' ||
      source.data.status !== 'running'
    )
      throw new StorageError('INVALID_EVENT', 'Task creation requires its running delegation call');
    const parent = this.run(event.sessionId, source.runId);
    if (parent.status !== 'running' || !task.role.enabled)
      throw new StorageError('CONFLICT', 'Task parent or role is not active');
    const rootRunId = this.root(event.sessionId, parent.id);
    const root = this.run(event.sessionId, rootRunId);
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, event.sessionId))
      .get();
    if (
      root.status !== 'running' ||
      session?.activeRunId !== rootRunId ||
      session.data.activeBranchId !== parent.branchId
    )
      throw new StorageError('CONFLICT', 'Task root is not the active branch execution');
    let anchorMessageId = source.anchorMessageId;
    if (parent.taskId !== undefined) {
      const owner = this.tasks.row(event.sessionId, parent.taskId);
      if (
        owner.closedAt !== null ||
        (owner.data.role.access === 'read-only' && task.role.access === 'write')
      )
        throw new StorageError('CONFLICT', 'Task cannot exceed or outlive its parent');
      for (const field of Object.keys(owner.data.limits) as (keyof typeof task.limits)[])
        if (task.limits[field] > owner.data.limits[field])
          throw new StorageError('INVALID_EVENT', 'Task limits cannot exceed the parent limits');
      anchorMessageId = owner.anchorMessageId;
    }
    this.db
      .insert(schema.agentTasks)
      .values({
        id: task.id,
        sessionId: event.sessionId,
        sourceToolCallId: task.sourceToolCallId,
        parentRunId: parent.id,
        rootRunId,
        branchId: parent.branchId,
        anchorMessageId,
        createdAt: task.createdAt,
        updatedAt: event.at,
        waiting: null,
        closedAt: null,
        closeReason: null,
        error: null,
        data: task,
      })
      .run();
  }

  public close(event: HarnessEvent): void {
    const input = checked(TaskClosedSchema, event.data);
    const task = this.tasks.row(event.sessionId, input.taskId);
    this.actor(event, task.rootRunId);
    if (task.closedAt !== null) throw new StorageError('CONFLICT', 'Task is already closed');
    const ownRuns = this.tasks.runs(event.sessionId, input.taskId);
    if (ownRuns.some((run) => run.status === 'running'))
      throw new StorageError('CONFLICT', 'Task resources must settle before closing');
    const ownIds = new Set(ownRuns.map((run) => run.id));
    if (
      this.db
        .select()
        .from(schema.agentTasks)
        .where(eq(schema.agentTasks.sessionId, event.sessionId))
        .all()
        .some((child) => ownIds.has(child.parentRunId) && child.closedAt === null)
    )
      throw new StorageError('CONFLICT', 'Descendant tasks must close before their parent');
    this.db
      .update(schema.agentTasks)
      .set({
        closedAt: input.closedAt,
        closeReason: input.reason,
        error: input.error ?? null,
        waiting: null,
        updatedAt: event.at,
      })
      .where(eq(schema.agentTasks.id, input.taskId))
      .run();
  }

  public waiting(event: HarnessEvent): void {
    const input = checked(TaskWaitingSchema, event.data);
    const task = this.tasks.row(event.sessionId, input.taskId);
    const run = event.runId === null ? undefined : this.run(event.sessionId, event.runId);
    if (task.closedAt !== null || run?.status !== 'running' || run.taskId !== input.taskId)
      throw new StorageError('CONFLICT', 'Waiting state requires an active task run');
    this.db
      .update(schema.agentTasks)
      .set({ waiting: input.waiting, updatedAt: event.at })
      .where(eq(schema.agentTasks.id, task.id))
      .run();
  }

  public queue(event: HarnessEvent): void {
    const { message } = checked(TaskMessageQueuedSchema, event.data);
    const source = this.run(event.sessionId, message.sourceRunId);
    if (event.runId !== source.id || source.status !== 'running')
      throw new StorageError('CONFLICT', 'Message sender must be active');
    let targetRunId: string;
    let taskId: string | null = null;
    if (message.target.kind === 'run') targetRunId = message.target.runId;
    else {
      const task = this.tasks.row(event.sessionId, message.target.taskId);
      if (task.closedAt !== null) throw new StorageError('CONFLICT', 'Message target is closed');
      targetRunId = task.parentRunId;
      taskId = task.id;
    }
    const target = this.run(event.sessionId, targetRunId);
    if (
      target.status !== 'running' ||
      this.root(event.sessionId, source.id) !== this.root(event.sessionId, target.id)
    )
      throw new StorageError('CONFLICT', 'Message target is outside the active task tree');
    this.db
      .insert(schema.agentMessages)
      .values({
        id: message.id,
        sessionId: event.sessionId,
        sourceRunId: source.id,
        targetRunId: message.target.kind === 'run' ? message.target.runId : null,
        targetTaskId: taskId,
        data: { ...message, status: 'queued', consumedRunId: null, finishedAt: null, reason: null },
      })
      .run();
  }

  public consume(event: HarnessEvent): void {
    const input = checked(TaskMessageConsumedSchema, event.data);
    const row = this.db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.id, input.messageId))
      .get();
    const run = this.run(event.sessionId, input.consumedRunId);
    if (
      !row ||
      row.sessionId !== event.sessionId ||
      row.data.status !== 'queued' ||
      run.status !== 'running' ||
      event.runId !== run.id
    )
      throw new StorageError('CONFLICT', 'Message no longer belongs to an active consumer');
    if (
      (row.targetRunId !== null && row.targetRunId !== run.id) ||
      (row.targetTaskId !== null && row.targetTaskId !== run.taskId)
    )
      throw new StorageError('INVALID_EVENT', 'Message consumer does not match its target');
    this.db
      .update(schema.agentMessages)
      .set({
        data: { ...row.data, status: 'consumed', consumedRunId: run.id, finishedAt: event.at },
      })
      .where(eq(schema.agentMessages.id, row.id))
      .run();
  }

  public undelivered(event: HarnessEvent): void {
    const input = checked(TaskMessageUndeliveredSchema, event.data);
    const row = this.db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.id, input.messageId),
          eq(schema.agentMessages.sessionId, event.sessionId),
        ),
      )
      .get();
    if (!row || row.data.status !== 'queued')
      throw new StorageError('CONFLICT', 'Message is already settled');
    this.actor(event, this.root(event.sessionId, row.sourceRunId));
    this.db
      .update(schema.agentMessages)
      .set({
        data: { ...row.data, status: 'undelivered', finishedAt: event.at, reason: input.reason },
      })
      .where(eq(schema.agentMessages.id, row.id))
      .run();
  }

  public assertChildrenClosed(sessionId: string, runId: string): void {
    if (
      this.db
        .select()
        .from(schema.agentTasks)
        .where(eq(schema.agentTasks.parentRunId, runId))
        .all()
        .some((task) => task.sessionId !== sessionId || task.closedAt === null)
    )
      throw new StorageError('CONFLICT', 'Run descendants must settle before its terminal outcome');
  }
}
