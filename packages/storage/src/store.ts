import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  BranchViewSchema,
  AppSettingsSchema,
  HarnessEventSchema,
  MessageViewSchema,
  ProviderConfigSchema,
  QueueInputSchema,
  RunViewSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
  type HarnessEvent,
  type AppSettings,
  type AppSettingsInput,
  type ProviderConfig,
  type SessionSnapshot,
  type SessionSummary,
  type Workspace,
  type WorkspaceRenameInput,
} from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { applyMigrations } from './migrations.js';
import { acquireProfileLock, type ProfileLock } from './profile-lock.js';
import { ProjectionWriter } from './projector.js';
import { WorkspaceRepository } from './workspaces.js';
import { ToolProjection } from './tools.js';
import * as schema from './schema.js';
import type { CreateSessionInput, EventInput, RequestAcceptance } from './types.js';
import {
  assertJson,
  checked,
  InputIdSchema,
  QueueRequestSchema,
  RunAcceptedSchema,
} from './validation.js';

/** SQLite facts and reconstructable projections owned by one profile daemon. */
export class ProfileStore {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly projector: ProjectionWriter;
  private readonly workspaces: WorkspaceRepository;
  private readonly tools: ToolProjection;
  private closed = false;

  public constructor(
    private readonly sqlite: Database.Database,
    private readonly lock: ProfileLock,
  ) {
    this.db = drizzle(sqlite, { schema });
    this.projector = new ProjectionWriter(this.db);
    this.workspaces = new WorkspaceRepository(this.db);
    this.tools = new ToolProjection(this.db);
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('STORAGE_CLOSED', 'Storage is closed');
  }

  private transaction<T>(operation: () => T): T {
    this.assertOpen();
    try {
      return this.sqlite.transaction(operation).immediate();
    } catch (error: unknown) {
      if (error instanceof StorageError) throw error;
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('SQLITE_CONSTRAINT')
      ) {
        throw new StorageError('CONFLICT', 'A stored identity or relationship already exists', {
          cause: error,
        });
      }
      throw error;
    }
  }

  /** Close the business database before releasing profile ownership; repeated close is safe. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.sqlite.close();
    } finally {
      this.lock.release();
    }
  }

  /** Public metadata only; credential presence is computed later by the credential owner. */
  public listProviders(): ProviderConfig[] {
    this.assertOpen();
    return this.db
      .select()
      .from(schema.providers)
      .orderBy(asc(schema.providers.id))
      .all()
      .map((row) => checked(ProviderConfigSchema, row.data));
  }

  /** Read one provider configuration without retrieving secrets. */
  public getProvider(id: string): ProviderConfig | undefined {
    this.assertOpen();
    const row = this.db.select().from(schema.providers).where(eq(schema.providers.id, id)).get();
    return row ? checked(ProviderConfigSchema, row.data) : undefined;
  }

  /** Save a caller-incremented revision; computed credential flags are never durable facts. */
  public putProvider(input: ProviderConfig, expectedRevision?: number): ProviderConfig {
    const value = checked(ProviderConfigSchema, {
      ...input,
      hasCredential: false,
      credentialType: null,
      legacy: false,
      configured: false,
      authSource: null,
      credentialPreview: null,
    });
    return this.transaction(() => {
      const current = this.getProvider(value.id);
      if (
        (expectedRevision !== undefined && current?.revision !== expectedRevision) ||
        value.revision !== (current?.revision ?? 0) + 1
      ) {
        throw new StorageError('CONFLICT', 'Provider configuration revision has changed');
      }
      this.db
        .insert(schema.providerVersions)
        .values({ id: value.id, revision: value.revision, data: value })
        .run();
      this.db
        .insert(schema.providers)
        .values({ id: value.id, revision: value.revision, data: value })
        .onConflictDoUpdate({
          target: schema.providers.id,
          set: { revision: value.revision, data: value },
        })
        .run();
      return value;
    });
  }

  /** Resolve the stable normal entry without changing historical provider identities. */
  public getBuiltinProviderId(builtinId: string): string | undefined {
    this.assertOpen();
    return this.db
      .select()
      .from(schema.builtinSlots)
      .where(eq(schema.builtinSlots.builtinId, builtinId))
      .get()?.providerId;
  }

  /** Bind a newly seeded native entry once; an existing binding cannot be replaced. */
  public bindBuiltinProvider(builtinId: string, providerId: string): void {
    this.transaction(() => {
      const current = this.getBuiltinProviderId(builtinId);
      if (current === providerId) return;
      if (current !== undefined)
        throw new StorageError('CONFLICT', 'Native provider entry already exists');
      const provider = this.getProvider(providerId);
      if (
        provider?.kind !== 'builtin' ||
        provider.builtinId !== builtinId ||
        provider.baseUrl !== null ||
        provider.models.length !== 0
      )
        throw new StorageError(
          'INVALID_RECORD',
          'Native entry requires unmodified factory metadata',
        );
      this.db.insert(schema.builtinSlots).values({ builtinId, providerId }).run();
    });
  }

  /** Defaults apply to future sessions, independently from existing session projections. */
  public getSettings(): AppSettings {
    this.assertOpen();
    return checked(
      AppSettingsSchema,
      this.db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)).get()?.data,
    );
  }

  /** Persist one optimistic settings revision without changing sessions or model history. */
  public putSettings(input: AppSettingsInput): AppSettings {
    return this.transaction(() => {
      const previous = this.getSettings();
      if (previous.revision !== input.expectedRevision)
        throw new StorageError('CONFLICT', 'Application settings revision has changed');
      const value = checked(AppSettingsSchema, {
        revision: previous.revision + 1,
        defaultModel: input.defaultModel,
      });
      this.db
        .update(schema.appSettings)
        .set({ revision: value.revision, data: value })
        .where(eq(schema.appSettings.id, 1))
        .run();
      return value;
    });
  }

  /** Remove current settings without rewriting sessions or accepted run history. */
  public deleteProvider(id: string): void {
    this.transaction(() => {
      this.db.delete(schema.providers).where(eq(schema.providers.id, id)).run();
    });
  }

  /** Create the initial branch and session event in one transaction. */
  public createSession(input: CreateSessionInput): SessionSummary {
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
    });
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
        accepted.push(event);
      }
      return accepted;
    });
  }

  /** Return only complete branch messages with private replay codecs; no streaming/error assistants. */
  public getModelContext(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): string[] {
    this.assertOpen();
    if (this.getSession(sessionId) === undefined)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    this.projector.session(sessionId);
    const branch = this.db
      .select()
      .from(schema.branches)
      .where(and(eq(schema.branches.id, branchId), eq(schema.branches.sessionId, sessionId)))
      .get();
    if (!branch)
      throw new StorageError('INVALID_RECORD', 'Context branch does not belong to this session');
    const rows = this.db
      .select({ data: schema.messages.data, privateData: schema.messages.privateData })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(eq(schema.branchMessages.branchId, branchId))
      .orderBy(asc(schema.branchMessages.ordinal))
      .all()
      .map((row) => ({
        message: checked(MessageViewSchema, row.data),
        privateData: row.privateData,
      }));
    const selected = messageIds === undefined ? undefined : new Set(messageIds);
    const contexts = this.tools.contexts(sessionId);
    if (
      selected !== undefined &&
      rows.filter((row) => selected.has(row.message.id)).length !== selected.size
    )
      throw new StorageError(
        'INVALID_RECORD',
        'Context messages must belong to the selected branch',
      );
    return rows.flatMap((row) => {
      const message = row.message;
      if (selected !== undefined && !selected.has(message.id)) return [];
      const replayable =
        message.status === 'complete' &&
        (message.role === 'user' ||
          message.stopReason === 'stop' ||
          message.stopReason === 'length' ||
          message.stopReason === 'toolUse');
      if (replayable && row.privateData === null)
        throw new StorageError(
          'INVALID_RECORD',
          'Replayable message is missing its provider codec',
        );
      return replayable && row.privateData !== null
        ? [row.privateData, ...(contexts.get(message.id) ?? [])]
        : [];
    });
  }

  /** Preserve partial output and queue; stale running records become interrupted, never retried. */
  public recoverInterrupted(): HarnessEvent[] {
    return this.transaction(() => {
      const output: HarnessEvent[] = [];
      for (const session of this.listSessions()) {
        if (session.activeRunId === null) continue;
        const at = Date.now();
        const tools: EventInput[] = this.tools
          .unfinished(session.id, session.activeRunId)
          .map((tool) => ({
            type: 'tool.updated',
            runId: session.activeRunId,
            at,
            data: {
              tool: {
                ...tool,
                status: 'interrupted',
                updatedAt: at,
                summary: 'Daemon stopped before the tool completed',
              },
            },
          }));
        output.push(
          ...this.append(session.id, [
            ...tools,
            {
              type: 'run.finished',
              runId: session.activeRunId,
              at: Date.now(),
              data: {
                status: 'interrupted',
                finishedAt: Date.now(),
                error: 'Daemon stopped before a durable terminal outcome',
              },
            },
          ]),
        );
      }
      return output;
    });
  }
}

/**
 * Open one profile, migrate and interrupt old runs before any model work can begin.
 * @param directory Local application profile, separate from Pi or other harness data.
 * @returns An owned synchronous store with its cross-process lock held until close.
 */
export async function openProfileStore(directory: string): Promise<ProfileStore> {
  const lock = await acquireProfileLock(directory);
  let database: Database.Database | undefined;
  try {
    database = new Database(join(lock.directory, 'data.sqlite'), { timeout: 1000 });
    database.pragma('foreign_keys = ON');
    applyMigrations(database);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    const store = new ProfileStore(database, lock);
    store.recoverInterrupted();
    return store;
  } catch (error: unknown) {
    try {
      database?.close();
    } finally {
      lock.release();
    }
    throw error;
  }
}
