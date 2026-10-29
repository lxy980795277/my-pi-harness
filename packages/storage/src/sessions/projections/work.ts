import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  CheckpointSchema,
  WorkStateSchema,
  initialWorkState,
  type Checkpoint,
  type HarnessEvent,
  type WorkState,
  type Compaction,
} from '@my-pi-harness/protocol';
import { StorageError } from '../../shared/errors.js';
import * as schema from '../../sqlite/schema.js';
import { checked } from '../../shared/validation.js';
import { currentCapabilityRevision } from './capabilities.js';
import {
  CheckpointEventSchema,
  PreparedEventSchema,
  PreparedPrivateSchema,
  RestoreEventSchema,
  WorkEventSchema,
} from '../event-validation.js';

/** Branch-local context facts and frozen content; writes run inside the store transaction. */
export class WorkRepository {
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  private requireBranch(sessionId: string, branchId: string): void {
    const branch = this.db
      .select()
      .from(schema.branches)
      .where(and(eq(schema.branches.sessionId, sessionId), eq(schema.branches.id, branchId)))
      .get();
    if (!branch)
      throw new StorageError('INVALID_RECORD', 'Work branch does not belong to this session');
  }

  /** A summary retains the reset boundary that applied when its immutable version was created. */
  public compactionContextStart(sessionId: string, compactionId: string): string | null {
    const row = this.db
      .select({ data: schema.events.data })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.sessionId, sessionId),
          eq(schema.events.type, 'work.updated'),
          sql`json_extract(${schema.events.data}, '$.state.compaction.id') = ${compactionId}`,
        ),
      )
      .orderBy(asc(schema.events.seq))
      .limit(1)
      .get();
    if (row === undefined)
      throw new StorageError('INVALID_RECORD', 'Compaction has no recorded context baseline');
    return checked(WorkEventSchema, row.data).state.contextStartAfterMessageId;
  }

  private messageIds(branchId: string, taskId?: string): string[] {
    if (taskId !== undefined)
      return this.db
        .select({ id: schema.taskMessages.messageId })
        .from(schema.taskMessages)
        .where(eq(schema.taskMessages.taskId, taskId))
        .orderBy(asc(schema.taskMessages.ordinal))
        .all()
        .map((row) => row.id);
    return this.db
      .select({ id: schema.branchMessages.messageId })
      .from(schema.branchMessages)
      .where(eq(schema.branchMessages.branchId, branchId))
      .orderBy(asc(schema.branchMessages.ordinal))
      .all()
      .map((row) => row.id);
  }

  public get(sessionId: string, branchId: string): WorkState {
    this.requireBranch(sessionId, branchId);
    const row = this.db
      .select()
      .from(schema.workStates)
      .where(
        and(eq(schema.workStates.sessionId, sessionId), eq(schema.workStates.branchId, branchId)),
      )
      .get();
    if (!row) return initialWorkState(branchId);
    const state = checked(WorkStateSchema, row.data);
    if (state.branchId !== branchId || state.revision !== row.revision)
      throw new StorageError('INVALID_RECORD', 'Stored work state identity is inconsistent');
    return state;
  }

  public getTask(sessionId: string, taskId: string): WorkState {
    const task = this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .get();
    if (!task || task.sessionId !== sessionId)
      throw new StorageError('INVALID_RECORD', 'Work task does not belong to this session');
    const row = this.db
      .select()
      .from(schema.taskWorkStates)
      .where(eq(schema.taskWorkStates.taskId, taskId))
      .get();
    if (!row) return initialWorkState(task.branchId);
    const state = checked(WorkStateSchema, row.data);
    if (
      row.sessionId !== sessionId ||
      state.branchId !== task.branchId ||
      state.revision !== row.revision
    )
      throw new StorageError('INVALID_RECORD', 'Task work state identity is inconsistent');
    return state;
  }

  public interruptedTaskStates(sessionId: string): { taskId: string; state: WorkState }[] {
    return this.db
      .select()
      .from(schema.taskWorkStates)
      .where(eq(schema.taskWorkStates.sessionId, sessionId))
      .all()
      .map((row) => ({ taskId: row.taskId, state: this.getTask(sessionId, row.taskId) }))
      .filter(
        ({ state }) =>
          state.plan?.review === 'pending' ||
          state.questions.some((question) => question.status === 'pending'),
      );
  }

  public compactions(sessionId: string, branchId: string, taskId?: string): Compaction[] {
    const state =
      taskId === undefined ? this.get(sessionId, branchId) : this.getTask(sessionId, taskId);
    const versions = new Map<string, Compaction>();
    const selected = new Set<string>();
    if (state.compaction) selected.add(state.compaction.id);
    for (const row of this.db
      .select({ data: schema.events.data })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.sessionId, sessionId),
          eq(schema.events.type, 'work.updated'),
          taskId === undefined
            ? sql`json_extract(${schema.events.data}, '$.taskId') IS NULL`
            : sql`json_extract(${schema.events.data}, '$.taskId') = ${taskId}`,
        ),
      )
      .orderBy(asc(schema.events.seq))
      .all()) {
      const recorded = checked(WorkEventSchema, row.data).state;
      if (recorded.compaction) {
        versions.set(recorded.compaction.id, recorded.compaction);
        if (recorded.branchId === branchId) selected.add(recorded.compaction.id);
      }
    }
    for (const id of selected) {
      const parentId = versions.get(id)?.parentId;
      if (parentId !== null && parentId !== undefined) selected.add(parentId);
    }
    const messageIds = new Set(this.messageIds(branchId, taskId));
    return [...versions.values()].filter(
      (version) => selected.has(version.id) && messageIds.has(version.throughMessageId),
    );
  }

  public interruptedStates(sessionId: string): WorkState[] {
    return this.db
      .select()
      .from(schema.workStates)
      .where(eq(schema.workStates.sessionId, sessionId))
      .all()
      .map((row) => this.get(sessionId, row.branchId))
      .filter(
        (state) =>
          state.plan?.review === 'pending' ||
          state.questions.some((question) => question.status === 'pending'),
      );
  }

  public listCheckpoints(sessionId: string): Checkpoint[] {
    return this.db
      .select()
      .from(schema.checkpoints)
      .where(eq(schema.checkpoints.sessionId, sessionId))
      .orderBy(asc(schema.checkpoints.createdAt), asc(schema.checkpoints.id))
      .all()
      .map((row) => checked(CheckpointSchema, row.data));
  }

  private validateState(sessionId: string, state: WorkState, taskId?: string): void {
    this.requireBranch(sessionId, state.branchId);
    if (taskId !== undefined && this.getTask(sessionId, taskId).branchId !== state.branchId)
      throw new StorageError('INVALID_EVENT', 'Task work branch is inconsistent');
    const ids = this.messageIds(state.branchId, taskId);
    for (const anchor of [state.contextStartAfterMessageId, state.compaction?.throughMessageId]) {
      if (anchor !== null && anchor !== undefined && !ids.includes(anchor))
        throw new StorageError('INVALID_EVENT', 'Context anchor is outside the work branch');
    }
    if (state.compaction !== null) {
      const version = state.compaction;
      const existing = this.db
        .select({ data: schema.events.data })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.sessionId, sessionId),
            eq(schema.events.type, 'work.updated'),
            sql`json_extract(${schema.events.data}, '$.state.compaction.id') = ${version.id}`,
          ),
        )
        .get();
      if (
        existing &&
        (existing.data['taskId'] !== taskId ||
          !isDeepStrictEqual(checked(WorkStateSchema, existing.data['state']).compaction, version))
      )
        throw new StorageError('CONFLICT', 'An existing compaction version cannot be rewritten');
      if (!existing && version.parentId !== null) {
        const parent = this.db
          .select({ id: schema.events.eventId })
          .from(schema.events)
          .where(
            and(
              eq(schema.events.sessionId, sessionId),
              eq(schema.events.type, 'work.updated'),
              sql`json_extract(${schema.events.data}, '$.state.compaction.id') = ${version.parentId}`,
              taskId === undefined
                ? sql`json_extract(${schema.events.data}, '$.taskId') IS NULL`
                : sql`json_extract(${schema.events.data}, '$.taskId') = ${taskId}`,
            ),
          )
          .get();
        if (!parent || version.parentId === version.id)
          throw new StorageError(
            'INVALID_EVENT',
            'Compaction parent must name an earlier session version',
          );
      }
    }
    const questionIds = new Set<string>();
    for (const question of state.questions) {
      if (question.branchId !== state.branchId || questionIds.has(question.id))
        throw new StorageError('INVALID_EVENT', 'Question identity or branch is invalid');
      questionIds.add(question.id);
      const run = this.db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.id, question.runId))
        .get();
      if (
        !run ||
        run.sessionId !== sessionId ||
        run.branchId !== state.branchId ||
        run.data.taskId !== taskId
      )
        throw new StorageError('INVALID_EVENT', 'Question run is outside the work branch');
    }
    if (new Set(state.todos.map((todo) => todo.id)).size !== state.todos.length)
      throw new StorageError('INVALID_EVENT', 'Todo IDs must be unique');
  }

  public update(event: HarnessEvent): void {
    const { state, taskId } = checked(WorkEventSchema, event.data);
    this.validateState(event.sessionId, state, taskId);
    const previous =
      taskId === undefined
        ? this.get(event.sessionId, state.branchId)
        : this.getTask(event.sessionId, taskId);
    if (state.revision !== previous.revision + 1)
      throw new StorageError('CONFLICT', 'Work state revision has changed');
    if (event.runId !== null) {
      const run = this.db.select().from(schema.runs).where(eq(schema.runs.id, event.runId)).get();
      if (
        !run ||
        run.sessionId !== event.sessionId ||
        run.branchId !== state.branchId ||
        run.data.taskId !== taskId
      )
        throw new StorageError('INVALID_EVENT', 'Work update does not belong to the event run');
    }
    if (taskId !== undefined) {
      this.db
        .insert(schema.taskWorkStates)
        .values({ taskId, sessionId: event.sessionId, revision: state.revision, data: state })
        .onConflictDoUpdate({
          target: schema.taskWorkStates.taskId,
          set: { revision: state.revision, data: state },
        })
        .run();
      return;
    }
    this.db
      .insert(schema.workStates)
      .values({
        sessionId: event.sessionId,
        branchId: state.branchId,
        revision: state.revision,
        data: state,
      })
      .onConflictDoUpdate({
        target: [schema.workStates.sessionId, schema.workStates.branchId],
        set: { revision: state.revision, data: state },
      })
      .run();
  }

  public checkpoint(event: HarnessEvent): void {
    const { checkpoint } = checked(CheckpointEventSchema, event.data);
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, event.sessionId))
      .get();
    if (!session || session.activeRunId !== null)
      throw new StorageError('CONFLICT', 'Stop the active run before creating a checkpoint');
    if (
      checkpoint.sessionId !== event.sessionId ||
      checkpoint.state.branchId !== checkpoint.branchId
    )
      throw new StorageError('INVALID_EVENT', 'Checkpoint identity is inconsistent');
    this.validateState(event.sessionId, checkpoint.state);
    const ids = this.messageIds(checkpoint.branchId);
    if (
      checkpoint.messageIds.length > ids.length ||
      checkpoint.messageIds.some((id, index) => id !== ids[index])
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Checkpoint messages must be an ordered branch prefix',
      );
    for (const anchor of [
      checkpoint.state.contextStartAfterMessageId,
      checkpoint.state.compaction?.throughMessageId,
    ]) {
      if (anchor !== null && anchor !== undefined && !checkpoint.messageIds.includes(anchor))
        throw new StorageError(
          'INVALID_EVENT',
          'Checkpoint context anchor is outside its saved message prefix',
        );
    }
    const current = this.get(event.sessionId, checkpoint.branchId);
    if (!isDeepStrictEqual(current, checkpoint.state))
      throw new StorageError('CONFLICT', 'Checkpoint work state has changed');
    if (this.listCheckpoints(event.sessionId).length >= 100)
      throw new StorageError('CONFLICT', 'This session already has 100 checkpoints');
    this.db
      .insert(schema.checkpoints)
      .values({
        id: checkpoint.id,
        sessionId: event.sessionId,
        branchId: checkpoint.branchId,
        createdAt: checkpoint.createdAt,
        data: checkpoint,
      })
      .run();
  }

  public prepared(event: HarnessEvent, privateData?: Record<string, unknown>): void {
    const input = checked(PreparedEventSchema, event.data);
    if (
      event.runId !== null &&
      input.capabilityRevision !== undefined &&
      input.capabilityRevision !== currentCapabilityRevision(this.db, event.runId)
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Prepared request must use the current visible capability revision',
      );
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, event.sessionId))
      .get();
    const run =
      event.runId === null
        ? undefined
        : this.db.select().from(schema.runs).where(eq(schema.runs.id, event.runId)).get();
    if (
      !session ||
      !run ||
      (run.data.taskId === undefined && session.activeRunId !== run.id) ||
      run.data.taskId !== input.taskId ||
      run.sessionId !== event.sessionId ||
      run.data.status !== 'running' ||
      run.branchId !== input.branchId ||
      session.data.activeBranchId !== input.branchId
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Prepared context must belong to the active run and branch',
      );
    const ids = this.messageIds(input.branchId, input.taskId);
    let cursor = -1;
    for (const id of input.messageIds) {
      const next = ids.indexOf(id, cursor + 1);
      if (next === -1)
        throw new StorageError(
          'INVALID_EVENT',
          'Prepared messages must be an ordered branch subset',
        );
      cursor = next;
    }
    for (const id of input.attachmentIds ?? []) {
      if (
        !this.db
          .select({ id: schema.attachments.id })
          .from(schema.attachments)
          .where(eq(schema.attachments.id, id))
          .get()
      )
        throw new StorageError('INVALID_EVENT', 'Prepared attachment does not exist');
    }
    if (privateData === undefined)
      throw new StorageError('INVALID_EVENT', 'Prepared context requires its private request');
    checked(PreparedPrivateSchema, privateData);
  }

  public restore(event: HarnessEvent): void {
    const { branch, messageIds } = checked(RestoreEventSchema, event.data);
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, event.sessionId))
      .get();
    if (!session || session.activeRunId !== null)
      throw new StorageError('CONFLICT', 'Stop the active run before restoring a branch');
    if (
      branch.sessionId !== event.sessionId ||
      branch.parentId === null ||
      branch.id === branch.parentId
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Restored branch requires a distinct parent in this session',
      );
    this.requireBranch(event.sessionId, branch.parentId);
    const parentIds = this.messageIds(branch.parentId);
    if (
      messageIds.length > parentIds.length ||
      messageIds.some((id, index) => id !== parentIds[index])
    )
      throw new StorageError('INVALID_EVENT', 'Restored messages must be an ordered parent prefix');
    const last = messageIds.at(-1) ?? null;
    if (branch.forkMessageId !== last)
      throw new StorageError(
        'INVALID_EVENT',
        'Restored branch anchor must match its last inherited message',
      );
    this.db
      .insert(schema.branches)
      .values({ id: branch.id, sessionId: event.sessionId, data: branch })
      .run();
    for (const [index, messageId] of messageIds.entries())
      this.db
        .insert(schema.branchMessages)
        .values({ branchId: branch.id, messageId, ordinal: index + 1 })
        .run();
  }
}
