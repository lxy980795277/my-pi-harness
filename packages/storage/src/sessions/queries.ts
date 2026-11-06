import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  BranchViewSchema,
  HarnessEventSchema,
  MessageViewSchema,
  QueueInputSchema,
  RunViewSchema,
  SessionSnapshotSchema,
  type HarnessEvent,
  type SessionSnapshot,
  type SessionSummary,
  type ToolCallView,
} from '@my-pi-harness/protocol';
import type { RequestAcceptance } from '@my-pi-harness/protocol/internal';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import * as schema from '../sqlite/schema';
import { QueueRequestSchema } from './event-validation';
import type { LiveMessages } from './live-messages';
import type { ProjectionWriter } from './projections/projector';
import type { ToolProjection } from './projections/tools';

/** Session read models use the profile's database and message overlay; the owner supplies read transactions. */
export class SessionQueries {
  public constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly projector: ProjectionWriter,
    private readonly tools: ToolProjection,
    private readonly live: LiveMessages,
  ) {}

  /** Return the current session projection, not live SDK memory. */
  public getSession(id: string): SessionSummary | undefined {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    return row && !row.archived ? this.projector.session(id) : undefined;
  }

  /** Sort navigation by the latest committed event and validate every durable row. */
  public listSessions(): SessionSummary[] {
    return this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.archived, false))
      .all()
      .map((row) => this.projector.session(row.id))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  }

  /** Assemble the current branch and live output while the owner holds a read transaction. */
  public getSnapshot(id: string): SessionSnapshot {
    if (this.getSession(id) === undefined)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    const session = this.projector.session(id);
    const branchRows = this.db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.sessionId, id))
      .all();
    const messageRows = this.db
      .select({ data: schema.messages.data })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(eq(schema.branchMessages.branchId, session.activeBranchId))
      .orderBy(asc(schema.branchMessages.ordinal))
      .all();
    const runRows = this.db.select().from(schema.runs).where(eq(schema.runs.sessionId, id)).all();
    const queued = this.db.select().from(schema.queue).where(eq(schema.queue.sessionId, id)).all();
    return checked(SessionSnapshotSchema, {
      session,
      snapshotSeq: session.snapshotSeq,
      branches: branchRows.map((row) => checked(BranchViewSchema, row.data)),
      messages: this.live.merge(
        id,
        messageRows.map((row) => checked(MessageViewSchema, row.data)),
      ),
      liveRevision: this.live.revision(id),
      runs: runRows
        .filter((row) => row.taskId === null)
        .map((row) => checked(RunViewSchema, row.data)),
      tools: this.tools.list(id, session.activeBranchId),
      queue: queued
        .map((row) => checked(QueueInputSchema, row.data))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    });
  }

  /** Read one tool visible in the current branch without loading either root or child transcripts. */
  public getVisibleTool(sessionId: string, toolId: string): ToolCallView | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    return this.tools.visible(sessionId, toolId, session.activeBranchId);
  }

  /** An acceptance remains queryable after its queue item is consumed or removed. */
  public findRequest(sessionId: string, requestId: string): RequestAcceptance | undefined {
    const row = this.db
      .select()
      .from(schema.requests)
      .where(
        and(eq(schema.requests.sessionId, sessionId), eq(schema.requests.requestId, requestId)),
      )
      .get();
    return row ? { runId: row.runId, inputId: row.inputId } : undefined;
  }

  /** Host-only frozen input authority; browser responses never receive this column. */
  public getQueuePrivateData(sessionId: string, inputId: string): Record<string, unknown> | null {
    const row = this.db
      .select()
      .from(schema.queue)
      .where(and(eq(schema.queue.sessionId, sessionId), eq(schema.queue.id, inputId)))
      .get();
    if (row === undefined) throw new StorageError('CONFLICT', 'Queued input no longer exists');
    if (row.privateData === null) return null;
    checked(QueueRequestSchema, row.privateData);
    return row.privateData;
  }

  /** Resolve pending input provenance from its immutable acceptance and original run. */
  public getQueueBranch(sessionId: string, inputId: string): string {
    if (this.getSession(sessionId) === undefined)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    const queued = this.db
      .select()
      .from(schema.queue)
      .where(and(eq(schema.queue.sessionId, sessionId), eq(schema.queue.id, inputId)))
      .get();
    if (!queued) throw new StorageError('CONFLICT', 'Queued input no longer exists');
    checked(QueueInputSchema, queued.data);
    const acceptance = this.db
      .select({ version: schema.events.version, input: schema.events.data, run: schema.runs.data })
      .from(schema.events)
      .innerJoin(schema.runs, eq(schema.events.runId, schema.runs.id))
      .where(
        and(
          eq(schema.events.sessionId, sessionId),
          eq(schema.events.type, 'queue.added'),
          eq(schema.runs.sessionId, sessionId),
          sql`json_extract(${schema.events.data}, '$.id') = ${inputId}`,
        ),
      )
      .get();
    if (!acceptance)
      throw new StorageError('INVALID_RECORD', 'Queued input has no original run provenance');
    checked(HarnessEventSchema.properties.version, acceptance.version);
    const input = checked(QueueInputSchema, acceptance.input);
    const run = checked(RunViewSchema, acceptance.run);
    if (input.id !== inputId || input.sessionId !== sessionId || run.sessionId !== sessionId)
      throw new StorageError('INVALID_RECORD', 'Queued input provenance is inconsistent');
    return run.branchId;
  }

  /** Return committed public records only; host codecs do not cross the event stream. */
  public readEvents(sessionId: string, afterSeq = 0, limit = 1000): HarnessEvent[] {
    this.projector.session(sessionId);
    if (
      !Number.isSafeInteger(afterSeq) ||
      afterSeq < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new StorageError('INVALID_RECORD', 'Event page cursor or limit is invalid');
    return this.db
      .select({
        version: schema.events.version,
        eventId: schema.events.eventId,
        sessionId: schema.events.sessionId,
        runId: schema.events.runId,
        seq: schema.events.seq,
        type: schema.events.type,
        at: schema.events.at,
        data: schema.events.data,
      })
      .from(schema.events)
      .where(and(eq(schema.events.sessionId, sessionId), gt(schema.events.seq, afterSeq)))
      .orderBy(asc(schema.events.seq))
      .limit(limit)
      .all()
      .map((row) => checked(HarnessEventSchema, row));
  }
}
