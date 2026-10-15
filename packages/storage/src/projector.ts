import { and, asc, eq, max } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  BranchViewSchema,
  MessageViewSchema,
  QueueInputSchema,
  RunViewSchema,
  SessionPatchInputSchema,
  SessionSummarySchema,
  type HarnessEvent,
  type MessageView,
  type SessionSummary,
} from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { ToolProjection } from './tools.js';
import { WorkRepository } from './work.js';
import * as schema from './schema.js';
import {
  BranchSelectionSchema,
  checked,
  InputIdSchema,
  MessageCompletedSchema,
  MessageDeltaSchema,
  QueueRequestSchema,
  RunAcceptedSchema,
  RunFinishedSchema,
} from './validation.js';

/** Updates reconstructable projections inside the event append transaction. */
export class ProjectionWriter {
  private readonly tools: ToolProjection;
  private readonly work: WorkRepository;

  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {
    this.tools = new ToolProjection(db);
    this.work = new WorkRepository(db);
  }

  /** Validate and load an existing session whose durable cursor agrees with its projection. */
  public session(id: string): SessionSummary {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    if (!row) throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist');
    const session = checked(SessionSummarySchema, row.data);
    if (
      session.snapshotSeq !== row.snapshotSeq ||
      session.activeRunId !== row.activeRunId ||
      session.workspaceId !== row.workspaceId
    ) {
      throw new StorageError('INVALID_RECORD', 'Session cursor or active run is inconsistent');
    }
    return session;
  }

  private saveSession(session: SessionSummary): void {
    checked(SessionSummarySchema, session);
    this.db
      .update(schema.sessions)
      .set({ data: session, activeRunId: session.activeRunId, snapshotSeq: session.snapshotSeq })
      .where(eq(schema.sessions.id, session.id))
      .run();
  }

  private run(event: HarnessEvent): ReturnType<typeof checked<typeof RunViewSchema>> {
    if (event.runId === null)
      throw new StorageError('INVALID_EVENT', 'Run event requires a run ID');
    const row = this.db.select().from(schema.runs).where(eq(schema.runs.id, event.runId)).get();
    if (!row || row.sessionId !== event.sessionId)
      throw new StorageError('RUN_NOT_FOUND', 'Run does not belong to this session');
    return checked(RunViewSchema, row.data);
  }

  private message(event: HarnessEvent, id: string): MessageView {
    const row = this.db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    if (!row || row.sessionId !== event.sessionId)
      throw new StorageError('INVALID_EVENT', 'Message does not belong to this session');
    const message = checked(MessageViewSchema, row.data);
    if (message.runId !== event.runId)
      throw new StorageError('INVALID_EVENT', 'Message does not belong to this run');
    return message;
  }

  private addMessage(event: HarnessEvent, privateData: string | undefined): void {
    const message = checked(MessageViewSchema, event.data);
    if (message.sessionId !== event.sessionId || message.runId !== event.runId) {
      throw new StorageError('INVALID_EVENT', 'Message identity does not match its event');
    }
    const session = this.session(event.sessionId);
    if (message.branchId !== session.activeBranchId || message.runId !== session.activeRunId) {
      throw new StorageError('CONFLICT', 'Message must belong to the active branch and run');
    }
    if (event.runId !== null) this.run(event);
    this.db
      .insert(schema.messages)
      .values({
        id: message.id,
        sessionId: message.sessionId,
        data: message,
        privateData: privateData ?? null,
      })
      .run();
    const row = this.db
      .select({ last: max(schema.branchMessages.ordinal) })
      .from(schema.branchMessages)
      .where(eq(schema.branchMessages.branchId, message.branchId))
      .get();
    this.db
      .insert(schema.branchMessages)
      .values({ branchId: message.branchId, messageId: message.id, ordinal: (row?.last ?? 0) + 1 })
      .run();
  }

  private acceptRun(event: HarnessEvent, privateData: string | undefined): void {
    const accepted = checked(RunAcceptedSchema, event.data);
    const run = checked(RunViewSchema, accepted.run);
    const session = this.session(event.sessionId);
    if (
      run.sessionId !== event.sessionId ||
      run.id !== event.runId ||
      run.branchId !== session.activeBranchId ||
      run.status !== 'running' ||
      run.finishedAt !== null
    ) {
      throw new StorageError('INVALID_EVENT', 'Accepted run identity or initial state is invalid');
    }
    if (session.activeRunId !== null)
      throw new StorageError('CONFLICT', 'This session already has an active run');
    this.db
      .insert(schema.runs)
      .values({
        id: run.id,
        sessionId: run.sessionId,
        branchId: run.branchId,
        data: run,
        privateData: privateData ?? null,
      })
      .run();
    this.db
      .insert(schema.requests)
      .values({
        sessionId: event.sessionId,
        requestId: accepted.requestId,
        runId: run.id,
        inputId: null,
      })
      .run();
    this.saveSession({ ...session, activeRunId: run.id });
  }

  private finishRun(event: HarnessEvent): void {
    const finished = checked(RunFinishedSchema, event.data);
    const run = this.run(event);
    if (run.status !== 'running')
      throw new StorageError('CONFLICT', 'Run already has a terminal outcome');
    const session = this.session(event.sessionId);
    if (session.activeRunId !== run.id)
      throw new StorageError('INVALID_RECORD', 'Run is not the active session run');
    this.db
      .update(schema.runs)
      .set({ data: { ...run, ...finished } })
      .where(eq(schema.runs.id, run.id))
      .run();
    const rows = this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, event.sessionId))
      .all();
    for (const row of rows) {
      const message = checked(MessageViewSchema, row.data);
      if (message.runId !== run.id || message.status !== 'streaming') continue;
      const status = finished.status === 'completed' ? 'complete' : finished.status;
      this.db
        .update(schema.messages)
        .set({ data: { ...message, status } })
        .where(eq(schema.messages.id, message.id))
        .run();
    }
    this.saveSession({ ...session, activeRunId: null });
  }

  private createBranch(event: HarnessEvent): void {
    const branch = checked(BranchViewSchema, event.data);
    const session = this.session(event.sessionId);
    if (session.activeRunId !== null)
      throw new StorageError('CONFLICT', 'Cannot edit history during an active run');
    if (
      branch.sessionId !== event.sessionId ||
      branch.parentId === null ||
      branch.forkMessageId === null
    ) {
      throw new StorageError(
        'INVALID_EVENT',
        'Revision branch requires a parent and edited user message',
      );
    }
    const parent = this.db
      .select()
      .from(schema.branches)
      .where(
        and(
          eq(schema.branches.id, branch.parentId),
          eq(schema.branches.sessionId, event.sessionId),
        ),
      )
      .get();
    if (!parent)
      throw new StorageError('INVALID_EVENT', 'Parent branch does not belong to this session');
    const history = this.db
      .select({
        ordinal: schema.branchMessages.ordinal,
        messageId: schema.branchMessages.messageId,
        message: schema.messages.data,
      })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(eq(schema.branchMessages.branchId, branch.parentId))
      .orderBy(asc(schema.branchMessages.ordinal))
      .all();
    const fork = history.find((row) => row.messageId === branch.forkMessageId);
    if (!fork || checked(MessageViewSchema, fork.message).role !== 'user') {
      throw new StorageError(
        'INVALID_EVENT',
        'Edited message must be a user message in the parent branch',
      );
    }
    this.db
      .insert(schema.branches)
      .values({ id: branch.id, sessionId: branch.sessionId, data: branch })
      .run();
    for (const row of history) {
      if (row.ordinal >= fork.ordinal) break;
      this.db
        .insert(schema.branchMessages)
        .values({ branchId: branch.id, messageId: row.messageId, ordinal: row.ordinal })
        .run();
    }
  }

  private addQueue(event: HarnessEvent, privateData: string | undefined): void {
    const input = checked(QueueInputSchema, event.data);
    if (input.sessionId !== event.sessionId || input.revision !== 1)
      throw new StorageError('INVALID_EVENT', 'Queued input identity or revision is invalid');
    if (privateData === undefined)
      throw new StorageError('INVALID_EVENT', 'Queued input requires an idempotency record');
    const run = this.run(event);
    if (run.status !== 'running' || this.session(event.sessionId).activeRunId !== run.id)
      throw new StorageError('CONFLICT', 'Queued input must originate in the active run');
    const metadata: unknown = JSON.parse(privateData);
    const request = checked(QueueRequestSchema, metadata);
    this.db
      .insert(schema.queue)
      .values({ id: input.id, sessionId: input.sessionId, data: input })
      .run();
    this.db
      .insert(schema.requests)
      .values({
        sessionId: input.sessionId,
        requestId: request.requestId,
        runId: null,
        inputId: input.id,
      })
      .run();
  }

  /**
   * Apply one event and then advance the session cursor in the same transaction.
   * @param event Already validated public event envelope.
   * @param privateData Host-only codec or request metadata, omitted from public events.
   */
  public apply(event: HarnessEvent, privateData?: string): void {
    switch (event.type) {
      case 'work.updated':
        this.work.update(event);
        break;
      case 'checkpoint.created':
        this.work.checkpoint(event);
        break;
      case 'branch.restored':
        this.work.restore(event);
        break;
      case 'context.prepared':
        this.work.prepared(event, privateData);
        break;
      case 'run.accepted':
        this.acceptRun(event, privateData);
        break;
      case 'run.started':
      case 'run.cancel_requested':
        if (this.run(event).status !== 'running')
          throw new StorageError('CONFLICT', 'Run is already terminal');
        break;
      case 'run.finished':
        this.finishRun(event);
        break;
      case 'tool.requested':
      case 'tool.updated':
        this.tools.apply(event);
        break;
      case 'tool.context':
        this.tools.context(event, privateData);
        break;
      case 'message.started':
        this.addMessage(event, privateData);
        break;
      case 'message.delta': {
        const delta = checked(MessageDeltaSchema, event.data);
        const message = this.message(event, delta.messageId);
        if (message.role !== 'assistant' || message.status !== 'streaming')
          throw new StorageError('CONFLICT', 'Message no longer accepts stream deltas');
        const updated = checked(MessageViewSchema, {
          ...message,
          text: message.text + (delta.text ?? ''),
          thinking: message.thinking + (delta.thinking ?? ''),
        });
        this.db
          .update(schema.messages)
          .set({ data: updated })
          .where(eq(schema.messages.id, message.id))
          .run();
        break;
      }
      case 'message.completed': {
        const completed = checked(MessageCompletedSchema, event.data);
        const message = checked(MessageViewSchema, completed.message);
        const previous = this.message(event, message.id);
        if (
          previous.role !== message.role ||
          previous.branchId !== message.branchId ||
          previous.createdAt !== message.createdAt ||
          message.status === 'streaming'
        )
          throw new StorageError(
            'INVALID_EVENT',
            'Completed message identity or status is invalid',
          );
        if (previous.status !== 'streaming' && JSON.stringify(previous) !== JSON.stringify(message))
          throw new StorageError('CONFLICT', 'Completed history cannot be rewritten');
        this.db
          .update(schema.messages)
          .set({ data: message, privateData: privateData ?? null })
          .where(eq(schema.messages.id, message.id))
          .run();
        break;
      }
      case 'queue.added':
        this.addQueue(event, privateData);
        break;
      case 'queue.updated': {
        const input = checked(QueueInputSchema, event.data);
        const row = this.db.select().from(schema.queue).where(eq(schema.queue.id, input.id)).get();
        if (!row || row.sessionId !== event.sessionId)
          throw new StorageError('CONFLICT', 'Queued input no longer exists');
        const previous = checked(QueueInputSchema, row.data);
        if (
          input.sessionId !== previous.sessionId ||
          input.createdAt !== previous.createdAt ||
          input.revision !== previous.revision + 1 ||
          input.mode !== previous.mode ||
          input.providerId !== previous.providerId ||
          input.modelId !== previous.modelId
        )
          throw new StorageError('CONFLICT', 'Queued input was modified or consumed');
        this.db
          .update(schema.queue)
          .set({ data: input })
          .where(eq(schema.queue.id, input.id))
          .run();
        break;
      }
      case 'queue.deleted':
      case 'queue.consumed': {
        const value = checked(InputIdSchema, event.data);
        const row = this.db
          .select()
          .from(schema.queue)
          .where(eq(schema.queue.id, value.inputId))
          .get();
        if (!row || row.sessionId !== event.sessionId)
          throw new StorageError('CONFLICT', 'Queued input no longer exists');
        if (event.type === 'queue.consumed' && this.run(event).status !== 'running')
          throw new StorageError('CONFLICT', 'Queued input requires an active run');
        this.db.delete(schema.queue).where(eq(schema.queue.id, value.inputId)).run();
        break;
      }
      case 'branch.created':
        this.createBranch(event);
        break;
      case 'branch.selected': {
        const selected = checked(BranchSelectionSchema, event.data);
        const session = this.session(event.sessionId);
        if (session.activeRunId !== null)
          throw new StorageError('CONFLICT', 'Cannot select a branch during an active run');
        const branch = this.db
          .select()
          .from(schema.branches)
          .where(
            and(
              eq(schema.branches.id, selected.branchId),
              eq(schema.branches.sessionId, event.sessionId),
            ),
          )
          .get();
        if (!branch)
          throw new StorageError('INVALID_EVENT', 'Branch does not belong to this session');
        this.saveSession({ ...session, activeBranchId: selected.branchId });
        break;
      }
      case 'session.configured': {
        const update = checked(SessionPatchInputSchema, event.data);
        this.saveSession({ ...this.session(event.sessionId), ...update });
        break;
      }
      case 'session.deleted': {
        const session = this.session(event.sessionId);
        if (session.activeRunId !== null)
          throw new StorageError('CONFLICT', 'Cannot archive a session during an active run');
        this.db
          .update(schema.sessions)
          .set({ archived: true })
          .where(eq(schema.sessions.id, event.sessionId))
          .run();
        break;
      }
      case 'session.created':
        throw new StorageError('CONFLICT', 'Session creation is already committed');
      default:
        // Future progress/audit event types have no projection until their owner defines one.
        if (event.runId !== null) this.run(event);
    }
    this.saveSession({
      ...this.session(event.sessionId),
      snapshotSeq: event.seq,
      updatedAt: event.at,
    });
  }
}
