import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  ArtifactSchema,
  MessageViewSchema,
  QueueInputSchema,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import type { ArtifactBlobs } from '../artifacts/blobs';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import * as schema from '../sqlite/schema';
import { validateAgentBatch } from './agent-batch';
import type { AttachmentBlobs } from './attachment-blobs';
import { SessionCreatedSchema } from './event-validation';
import type { ProjectionWriter } from './projections/projector';
import { validateToolBatch } from './projections/tool-batch';
import type { SessionJournal } from './session-jsonl';

/** Rebuilds disposable projections from authoritative files inside the owner's startup transaction. */
export class SessionRecovery {
  public constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly projector: ProjectionWriter,
    private readonly journal: SessionJournal,
    private readonly blobs: AttachmentBlobs,
    private readonly artifactBlobs: ArtifactBlobs,
  ) {}

  private createProjection(event: HarnessEvent): void {
    const { session, branch } = checked(SessionCreatedSchema, event.data);
    if (
      event.seq !== 1 ||
      event.runId !== null ||
      session.id !== event.sessionId ||
      session.snapshotSeq !== 1 ||
      session.activeRunId !== null ||
      session.activeBranchId !== branch.id ||
      branch.sessionId !== session.id ||
      branch.parentId !== null ||
      branch.forkMessageId !== null
    )
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Initial session and branch identities are invalid',
      );
    this.db
      .insert(schema.sessions)
      .values({
        id: session.id,
        data: session,
        snapshotSeq: 1,
        activeRunId: null,
        workspaceId: session.workspaceId,
      })
      .run();
    this.db
      .insert(schema.branches)
      .values({ id: branch.id, sessionId: session.id, data: branch })
      .run();
  }

  public rebuild(): void {
    const ids = this.journal.sessionIds();
    const available = new Set(ids);
    const previousIds = this.db.select({ id: schema.sessions.id }).from(schema.sessions).all();
    for (const { id } of previousIds)
      if (!available.has(id))
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'An authoritative session journal is missing; SQLite cannot replace it',
        );
    for (const table of [
      schema.memoryAdoptions,
      schema.taskMessages,
      schema.taskWorkStates,
      schema.agentMessages,
      schema.agentTasks,
      schema.toolContexts,
      schema.artifacts,
      schema.toolCalls,
      schema.branchMessages,
      schema.workStates,
      schema.checkpoints,
      schema.requests,
      schema.queue,
      schema.events,
      schema.messages,
      schema.runs,
      schema.branches,
      schema.sessions,
      schema.attachments,
    ])
      this.db.delete(table).run();
    for (const id of this.blobs.ids()) {
      const content = this.blobs.read(id);
      if (!content)
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'Attachment blob disappeared during recovery',
        );
      this.db.insert(schema.attachments).values({ id, data: content.attachment }).run();
    }
    for (const id of ids) {
      for (const records of this.journal.read(id)) {
        validateToolBatch(records.map(({ event, privateData }) => ({ ...event, privateData })));
        validateAgentBatch(
          this.db,
          id,
          records.map(({ event, privateData }) => ({
            ...event,
            ...(privateData === null ? {} : { privateData }),
          })),
        );
        for (const { event, privateData } of records) {
          if (event.type === 'session.created') this.createProjection(event);
          else this.projector.apply(event, privateData ?? undefined);
          this.db
            .insert(schema.events)
            .values({
              ...event,
              privateData: event.type === 'context.prepared' ? null : privateData,
            })
            .run();
        }
      }
    }
    for (const { data } of this.db
      .select({ data: schema.artifacts.data })
      .from(schema.artifacts)
      .all())
      this.artifactBlobs.read(checked(ArtifactSchema, data));
    for (const { id } of previousIds)
      if (
        !this.db
          .select({ id: schema.sessions.id })
          .from(schema.sessions)
          .where(eq(schema.sessions.id, id))
          .get()
      )
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'An indexed session journal contains no committed creation record',
        );
    const attachmentIds = new Set<string>();
    for (const { data } of this.db
      .select({ data: schema.messages.data })
      .from(schema.messages)
      .all()) {
      const message = checked(MessageViewSchema, data);
      if (message.attachmentIds === undefined) continue;
      for (const id of message.attachmentIds) attachmentIds.add(id);
    }
    for (const { data } of this.db.select({ data: schema.queue.data }).from(schema.queue).all()) {
      const queued = checked(QueueInputSchema, data);
      if (queued.attachmentIds === undefined) continue;
      for (const id of queued.attachmentIds) attachmentIds.add(id);
    }
    for (const id of attachmentIds)
      if (
        !this.db
          .select({ id: schema.attachments.id })
          .from(schema.attachments)
          .where(eq(schema.attachments.id, id))
          .get()
      )
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'A committed message or queued input attachment blob is missing',
        );
  }
}
