import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  BranchViewSchema,
  HarnessEventSchema,
  MessageViewSchema,
  QueueInputSchema,
  RunViewSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
  initialWorkState,
  WorkStateSchema,
  type Compaction,
  type HarnessEvent,
  type AppSettings,
  type AppSettingsInput,
  type ProviderConfig,
  type SessionSnapshot,
  type SessionSummary,
  type Workspace,
  type WorkspaceRenameInput,
  type WorkState,
  type AttachmentContent,
  type Checkpoint,
  type FrozenSkill,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { AuthRepository } from '../repositories/auth.js';
import { McpRepository } from '../repositories/mcp.js';
import { ExtensionRepository } from '../repositories/extensions.js';
import { RemoteMcpRepository } from '../repositories/remote-mcp.js';
import { ConnectionRepository } from '../repositories/connections.js';
import type { ProfileLock } from './profile-lock.js';
import { ProjectionWriter } from '../sessions/projections/projector.js';
import { WorkspaceRepository } from '../repositories/workspaces.js';
import { ModelSettingsRepository } from '../repositories/model-settings.js';
import { ToolProjection } from '../sessions/projections/tools.js';
import { WorkRepository } from '../sessions/projections/work.js';
import {
  SessionJournal,
  type SessionLogDownload,
  type StoredSessionEvent,
} from '../sessions/session-jsonl.js';
import { PrivateSessionFiles } from '../sessions/private-files.js';
import { AttachmentBlobs } from '../sessions/attachment-blobs.js';
import { interruptionEvents } from '../sessions/interruption.js';
import { validateToolBatch } from '../sessions/projections/tool-batch.js';
import { ModelContextQuery } from '../sessions/model-context.js';
import type { ProfileStoreOptions } from '../sessions/session-log-directory.js';
import { SkillContextQuery } from '../sessions/skill-context.js';
import * as schema from '../sqlite/schema.js';
import type { CreateSessionInput, EventInput, RequestAcceptance } from '../sessions/types.js';
import { assertJson, checked } from '../shared/validation.js';
import {
  InputIdSchema,
  QueueRequestSchema,
  RunAcceptedSchema,
} from '../sessions/event-validation.js';

/** JSONL session facts, immutable attachments and SQLite configuration/projections for one daemon. */
export class ProfileStore {
  public readonly auth: AuthRepository;
  public readonly mcp: McpRepository;
  public readonly extensions: ExtensionRepository;
  public readonly remoteMcp: RemoteMcpRepository;
  public readonly connections: ConnectionRepository;
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly projector: ProjectionWriter;
  private readonly workspaces: WorkspaceRepository;
  private readonly modelSettings: ModelSettingsRepository;
  private readonly tools: ToolProjection;
  private readonly modelContext: ModelContextQuery;
  private readonly work: WorkRepository;
  private closed = false;
  private readonly files: PrivateSessionFiles;
  private readonly journal: SessionJournal;
  private readonly blobs: AttachmentBlobs;
  private pendingRecords: StoredSessionEvent[] = [];
  private transactionDepth = 0;
  private writeFailure: StorageError | undefined;

  public constructor(
    private readonly sqlite: Database.Database,
    private readonly lock: ProfileLock,
    options: ProfileStoreOptions = {},
  ) {
    this.auth = new AuthRepository(sqlite, () => this.assertOpen());
    this.mcp = new McpRepository(sqlite, () => this.assertOpen());
    this.extensions = new ExtensionRepository(sqlite, () => this.assertOpen());
    this.remoteMcp = new RemoteMcpRepository(sqlite, () => this.assertOpen());
    this.connections = new ConnectionRepository(sqlite, () => this.assertOpen());
    this.db = drizzle(sqlite, { schema });
    this.projector = new ProjectionWriter(this.db);
    this.workspaces = new WorkspaceRepository(this.db);
    this.modelSettings = new ModelSettingsRepository(
      this.db,
      () => this.assertOpen(),
      (operation) => this.transaction(operation),
    );
    this.tools = new ToolProjection(this.db);
    this.modelContext = new ModelContextQuery(this.db);
    this.work = new WorkRepository(this.db);
    this.files = new PrivateSessionFiles(lock.directory, options.sessionLogRoot);
    this.journal = new SessionJournal(this.files);
    this.blobs = new AttachmentBlobs(this.files);
    try {
      this.rebuildProjections();
    } catch (error) {
      this.files.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('STORAGE_CLOSED', 'Storage is closed');
  }

  private createProjection(event: HarnessEvent): void {
    const session = checked(SessionSummarySchema, event.data['session']);
    const branch = checked(BranchViewSchema, event.data['branch']);
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

  private rebuildProjections(): void {
    const ids = this.journal.sessionIds();
    const available = new Set(ids);
    const previousIds = this.db.select({ id: schema.sessions.id }).from(schema.sessions).all();
    for (const { id } of previousIds)
      if (!available.has(id))
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'An authoritative session journal is missing; SQLite cannot replace it',
        );
    this.sqlite
      .transaction(() => {
        for (const table of [
          schema.toolContexts,
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
          for (const batch of this.journal.read(id)) {
            validateToolBatch(
              batch.records.map(({ event, privateData }) => ({ ...event, privateData })),
            );
            for (const { event, privateData } of batch.records) {
              if (event.type === 'session.created') this.createProjection(event);
              else this.projector.apply(event, privateData ?? undefined);
              this.db
                .insert(schema.events)
                .values({ ...event, privateData })
                .run();
            }
          }
        }
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
        for (const { data } of this.db
          .select({ data: schema.queue.data })
          .from(schema.queue)
          .all()) {
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
      })
      .immediate();
  }

  private transaction<T>(operation: () => T, readOnly = false): T {
    this.assertOpen();
    if (!readOnly && this.writeFailure) throw this.writeFailure;
    const outer = this.transactionDepth === 0;
    const previousLength = this.pendingRecords.length;
    let logged = false;
    this.transactionDepth += 1;
    try {
      return this.sqlite
        .transaction(() => {
          const result = operation();
          if (outer && !readOnly && this.pendingRecords.length > 0) {
            const sessionId = this.pendingRecords[0]?.event.sessionId;
            if (
              !sessionId ||
              this.pendingRecords.some((record) => record.event.sessionId !== sessionId)
            )
              throw new StorageError(
                'INVALID_RECORD',
                'One command transaction must belong to one session',
              );
            try {
              this.journal.append(sessionId, this.pendingRecords);
            } catch (cause) {
              this.writeFailure = new StorageError(
                'SESSION_LOG_UNAVAILABLE',
                'Session journal write failed and its commit outcome may be unknown. Restart before retrying; uncertain operations must not be repeated.',
                { cause },
              );
              throw this.writeFailure;
            }
            logged = true;
          }
          return result;
        })
        .immediate();
    } catch (error: unknown) {
      this.pendingRecords.length = previousLength;
      if (logged) {
        this.writeFailure = new StorageError(
          'SESSION_LOG_UNAVAILABLE',
          'Session journal is committed but its SQLite projection failed. Restart before retrying; committed operations must not be repeated.',
          { cause: error },
        );
        throw this.writeFailure;
      }
      if (error instanceof StorageError) throw error;
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('SQLITE_CONSTRAINT')
      )
        throw new StorageError('CONFLICT', 'A stored identity or relationship already exists', {
          cause: error,
        });
      throw error;
    } finally {
      this.transactionDepth -= 1;
      if (outer) this.pendingRecords.length = previousLength;
    }
  }

  /** Close the business database before releasing profile ownership; repeated close is safe. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      try {
        this.files.close();
      } finally {
        this.sqlite.close();
      }
    } finally {
      this.lock.release();
    }
  }

  /** Public metadata only; credential presence is computed later by the credential owner. */
  public listProviders(): ProviderConfig[] {
    return this.modelSettings.listProviders();
  }

  /** Read one provider configuration without retrieving secrets. */
  public getProvider(id: string): ProviderConfig | undefined {
    return this.modelSettings.getProvider(id);
  }

  /** Save a caller-incremented revision; computed credential flags are never durable facts. */
  public putProvider(input: ProviderConfig, expectedRevision?: number): ProviderConfig {
    return this.modelSettings.putProvider(input, expectedRevision);
  }

  /** Resolve the stable normal entry without changing historical provider identities. */
  public getBuiltinProviderId(builtinId: string): string | undefined {
    return this.modelSettings.getBuiltinProviderId(builtinId);
  }

  /** Bind a newly seeded native entry once; an existing binding cannot be replaced. */
  public bindBuiltinProvider(builtinId: string, providerId: string): void {
    this.modelSettings.bindBuiltinProvider(builtinId, providerId);
  }

  /** Defaults apply to future sessions, independently from existing session projections. */
  public getSettings(): AppSettings {
    return this.modelSettings.getSettings();
  }

  /** Persist one optimistic settings revision without changing sessions or model history. */
  public putSettings(input: AppSettingsInput): AppSettings {
    return this.modelSettings.putSettings(input);
  }

  /** Remove current settings without rewriting sessions or accepted run history. */
  public deleteProvider(id: string): void {
    this.modelSettings.deleteProvider(id);
  }

  /** Create the initial branch and session event in one transaction. */
  public createSession(input: CreateSessionInput): SessionSummary {
    this.files.validateId(input.id);
    return this.transaction(() => {
      if (input.workspaceId !== null && this.workspaces.get(input.workspaceId) === undefined)
        throw new StorageError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
      const session = checked(SessionSummarySchema, {
        id: input.id,
        title: input.title,
        providerId: input.providerId,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
        workspaceId: input.workspaceId,
        approvalMode: input.approvalMode,
        createdAt: input.at,
        updatedAt: input.at,
        activeBranchId: input.branchId,
        activeRunId: null,
        snapshotSeq: 1,
      });
      const branch = checked(BranchViewSchema, {
        id: input.branchId,
        sessionId: input.id,
        parentId: null,
        forkMessageId: null,
        createdAt: input.at,
      });
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
      const event = checked(HarnessEventSchema, {
        version: 1,
        eventId: randomUUID(),
        sessionId: session.id,
        runId: null,
        seq: 1,
        type: 'session.created',
        at: input.at,
        data: { session, branch },
      });
      this.db
        .insert(schema.events)
        .values({ ...event, privateData: null })
        .run();
      this.pendingRecords.push({ event, privateData: null });
      if (input.workMode === 'plan') {
        this.append(session.id, [
          {
            type: 'work.updated',
            runId: null,
            at: input.at,
            data: { state: { ...initialWorkState(branch.id), revision: 1, mode: 'plan' } },
          },
        ]);
        return this.projector.session(session.id);
      }
      return session;
    });
  }

  /** Registered active directories; filesystem availability is checked by the daemon owner. */
  public listWorkspaces(): Workspace[] {
    this.assertOpen();
    return this.workspaces.list();
  }

  public getWorkspace(id: string): Workspace | undefined {
    this.assertOpen();
    return this.workspaces.get(id);
  }

  /** Persist a canonical directory after the host has checked its identity and access. */
  public createWorkspace(input: Workspace): Workspace {
    return this.transaction(() => this.workspaces.create(input));
  }

  public renameWorkspace(id: string, input: WorkspaceRenameInput, at: number): Workspace {
    return this.transaction(() => this.workspaces.rename(id, input, at));
  }

  /** Hide metadata only after every referencing session has been archived. */
  public archiveWorkspace(id: string): void {
    this.transaction(() => this.workspaces.archive(id));
  }

  /** Return the current session projection, not live SDK memory. */
  public getSession(id: string): SessionSummary | undefined {
    this.assertOpen();
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    return row && !row.archived ? this.projector.session(id) : undefined;
  }

  /** Export this session's original committed JSONL across all branches; credentials are separate. */
  public exportSessionLog(id: string): SessionLogDownload {
    this.assertOpen();
    if (this.writeFailure) throw this.writeFailure;
    if (this.getSession(id) === undefined)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    return this.journal.openDownload(id);
  }

  /** Sort navigation by the latest committed event and validate every durable row. */
  public listSessions(): SessionSummary[] {
    this.assertOpen();
    return this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.archived, false))
      .all()
      .map((row) => this.projector.session(row.id))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  }

  /** Read every projection and its cursor atomically; messages follow selected branch history. */
  public getSnapshot(id: string): SessionSnapshot {
    return this.transaction(() => {
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
      const queued = this.db
        .select()
        .from(schema.queue)
        .where(eq(schema.queue.sessionId, id))
        .all();
      return checked(SessionSnapshotSchema, {
        session,
        snapshotSeq: session.snapshotSeq,
        branches: branchRows.map((row) => checked(BranchViewSchema, row.data)),
        messages: messageRows.map((row) => checked(MessageViewSchema, row.data)),
        runs: runRows.map((row) => checked(RunViewSchema, row.data)),
        tools: this.tools.list(id, session.activeBranchId),
        queue: queued
          .map((row) => checked(QueueInputSchema, row.data))
          .sort(
            (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
          ),
      });
    }, true);
  }

  /** Read the selected branch's durable work state, or the empty revision-zero state. */
  public getWorkState(sessionId: string, branchId?: string): WorkState {
    this.assertOpen();
    const session = this.getSession(sessionId);
    if (!session)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    return this.work.get(sessionId, branchId ?? session.activeBranchId);
  }

  /** Checkpoints retain their original branch and immutable message prefix. */
  public listCheckpoints(sessionId: string): Checkpoint[] {
    this.assertOpen();
    if (!this.getSession(sessionId))
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    return this.work.listCheckpoints(sessionId);
  }

  /** All recorded summary versions for one branch, independent of the currently selected summary. */
  public listCompactions(sessionId: string, branchId?: string): Compaction[] {
    this.assertOpen();
    const session = this.getSession(sessionId);
    if (!session)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    const selectedBranch = branchId ?? session.activeBranchId;
    const selectedState = this.work.get(sessionId, selectedBranch);
    const versions = new Map<string, Compaction>();
    const selected = new Set<string>();
    if (selectedState.compaction) selected.add(selectedState.compaction.id);
    const rows = this.db
      .select({ data: schema.events.data })
      .from(schema.events)
      .where(and(eq(schema.events.sessionId, sessionId), eq(schema.events.type, 'work.updated')))
      .orderBy(asc(schema.events.seq))
      .all();
    for (const row of rows) {
      const state = checked(WorkStateSchema, row.data['state']);
      if (state.compaction !== null) {
        versions.set(state.compaction.id, state.compaction);
        if (state.branchId === selectedBranch) selected.add(state.compaction.id);
      }
    }
    for (const id of selected) {
      const parentId = versions.get(id)?.parentId;
      if (parentId !== null && parentId !== undefined) selected.add(parentId);
    }
    const messageIds = new Set(
      this.db
        .select({ id: schema.branchMessages.messageId })
        .from(schema.branchMessages)
        .where(eq(schema.branchMessages.branchId, selectedBranch))
        .all()
        .map((row) => row.id),
    );
    return [...versions.values()].filter(
      (version) => selected.has(version.id) && messageIds.has(version.throughMessageId),
    );
  }

  /** Store frozen content privately; replacing an existing attachment ID is rejected. */
  public putAttachment(input: AttachmentContent): void {
    this.assertOpen();
    if (this.writeFailure) throw this.writeFailure;
    try {
      this.blobs.put(input);
    } catch (cause) {
      if (
        cause instanceof StorageError &&
        (cause.code === 'CONFLICT' || cause.code === 'INVALID_RECORD')
      )
        throw cause;
      this.writeFailure = new StorageError(
        'SESSION_LOG_UNAVAILABLE',
        'Attachment persistence failed; restart before another write',
        { cause },
      );
      throw this.writeFailure;
    }
    try {
      this.transaction(() =>
        this.db
          .insert(schema.attachments)
          .values({ id: input.attachment.id, data: input.attachment })
          .run(),
      );
    } catch (cause) {
      this.writeFailure = new StorageError(
        'SESSION_LOG_UNAVAILABLE',
        'Attachment blob is committed but its SQLite index failed; restart before another write',
        { cause },
      );
      throw this.writeFailure;
    }
  }

  public getAttachment(id: string): AttachmentContent | undefined {
    this.assertOpen();
    return this.blobs.read(id);
  }

  /** An acceptance remains queryable after its queue item is consumed or removed. */
  public findRequest(sessionId: string, requestId: string): RequestAcceptance | undefined {
    this.assertOpen();
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
  public getQueuePrivateData(sessionId: string, inputId: string): string | null {
    this.assertOpen();
    const row = this.db
      .select()
      .from(schema.queue)
      .where(and(eq(schema.queue.sessionId, sessionId), eq(schema.queue.id, inputId)))
      .get();
    if (row === undefined) throw new StorageError('CONFLICT', 'Queued input no longer exists');
    if (row.privateData === null) return null;
    const decoded: unknown = JSON.parse(row.privateData);
    checked(QueueRequestSchema, decoded);
    return row.privateData;
  }

  /** Resolve pending input provenance from its immutable acceptance and original run. */
  public getQueueBranch(sessionId: string, inputId: string): string {
    this.assertOpen();
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
    this.assertOpen();
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

  private duplicate(sessionId: string, inputs: readonly EventInput[]): boolean {
    if (inputs.length === 1 && inputs[0]?.type === 'run.finished') {
      const input = inputs[0];
      if (input.runId !== null) {
        const row = this.db
          .select()
          .from(schema.runs)
          .where(and(eq(schema.runs.id, input.runId), eq(schema.runs.sessionId, sessionId)))
          .get();
        if (row) {
          const run = checked(RunViewSchema, row.data);
          if (
            run.status !== 'running' &&
            run.status === input.data['status'] &&
            run.error === input.data['error']
          )
            return true;
        }
      }
    }
    for (const input of inputs) {
      let requestId: string | undefined;
      let incoming: RequestAcceptance | undefined;
      if (input.type === 'run.accepted') {
        const value = checked(RunAcceptedSchema, input.data);
        const run = checked(RunViewSchema, value.run);
        requestId = value.requestId;
        incoming = { runId: run.id, inputId: null };
      } else if (input.type === 'queue.added' && input.privateData !== undefined) {
        const value = checked(QueueInputSchema, input.data);
        const metadata: unknown = JSON.parse(input.privateData);
        requestId = checked(QueueRequestSchema, metadata).requestId;
        incoming = { runId: null, inputId: value.id };
      }
      if (requestId === undefined || incoming === undefined) continue;
      const previous = this.findRequest(sessionId, requestId);
      if (!previous) continue;
      if (previous.runId !== incoming.runId || previous.inputId !== incoming.inputId)
        throw new StorageError('CONFLICT', 'Request ID has already accepted another input');
      return true;
    }
    return false;
  }

  /** Append a complete command batch, immutable facts and projections in one short transaction. */
  public append(sessionId: string, inputs: readonly EventInput[]): HarnessEvent[] {
    return this.transaction(() => {
      const current = this.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .get();
      if (current?.archived) {
        if (inputs.length === 1 && inputs[0]?.type === 'session.deleted') return [];
        throw new StorageError('SESSION_NOT_FOUND', 'Session is archived');
      }
      const session = this.projector.session(sessionId);
      if (this.duplicate(sessionId, inputs)) return [];
      for (const input of inputs) {
        if (input.type !== 'queue.consumed') continue;
        const { inputId } = checked(InputIdSchema, input.data);
        const row = this.db
          .select()
          .from(schema.queue)
          .where(and(eq(schema.queue.id, inputId), eq(schema.queue.sessionId, sessionId)))
          .get();
        if (!row) throw new StorageError('CONFLICT', 'Queued input no longer exists');
        const queued = checked(QueueInputSchema, row.data);
        const message = inputs.find(
          (candidate) =>
            candidate.type === 'message.started' &&
            candidate.runId === input.runId &&
            candidate.data['role'] === 'user' &&
            candidate.data['text'] === queued.text,
        );
        if (!message)
          throw new StorageError(
            'INVALID_EVENT',
            'Queue consumption must atomically commit its user message',
          );
      }
      const accepted: HarnessEvent[] = [];
      for (const [index, input] of inputs.entries()) {
        assertJson(input.data);
        const data: unknown = JSON.parse(JSON.stringify(input.data));
        const event = checked(HarnessEventSchema, {
          version: 1,
          eventId: randomUUID(),
          sessionId,
          runId: input.runId,
          seq: session.snapshotSeq + index + 1,
          type: input.type,
          at: input.at,
          data,
        });
        this.projector.apply(event, input.privateData);
        this.db
          .insert(schema.events)
          .values({ ...event, privateData: input.privateData ?? null })
          .run();
        this.pendingRecords.push({ event, privateData: input.privateData ?? null });
        accepted.push(event);
      }

      validateToolBatch(inputs);
      return accepted;
    });
  }

  /** Return only complete branch messages with private replay codecs and canonical outcomes. */
  public getModelContext(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): string[] {
    this.assertOpen();
    if (this.getSession(sessionId) === undefined)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    this.projector.session(sessionId);
    return this.modelContext.read(sessionId, branchId, messageIds);
  }

  /** Return the reset marker recorded when this summary version was first committed. */
  public getCompactionContextStart(sessionId: string, compactionId: string): string | null {
    this.assertOpen();
    return this.work.compactionContextStart(sessionId, compactionId);
  }

  /** Read frozen instructions only from replayable messages in the requested branch prefix. */
  public getSkillContext(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): readonly FrozenSkill[] {
    this.assertOpen();
    return new SkillContextQuery(this.db).read(sessionId, branchId, messageIds);
  }

  /** Preserve partial output and queue; stale resources become interrupted, never retried. */
  public recoverInterrupted(): HarnessEvent[] {
    const output: HarnessEvent[] = [];
    for (const session of this.listSessions()) {
      const at = Date.now();
      const tools = this.db
        .select({ id: schema.runs.id })
        .from(schema.runs)
        .where(eq(schema.runs.sessionId, session.id))
        .all()
        .flatMap(({ id }) => this.tools.recovery(session.id, id, at));
      const inputs = interruptionEvents(
        session,
        this.work.interruptedStates(session.id),
        tools,
        at,
      );
      if (inputs.length > 0) output.push(...this.append(session.id, inputs));
    }
    return output;
  }
}
