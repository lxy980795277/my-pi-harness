import type Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  Compaction,
  HarnessEvent,
  AppSettings,
  AppSettingsInput,
  SessionSnapshot,
  SessionSummary,
  Workspace,
  WorkspaceRenameInput,
  WorkState,
  AttachmentContent,
  Checkpoint,
  AgentTaskSummary,
  AgentTaskDetail,
  AgentMessageTarget,
  AgentMessage,
  AgentBoard,
  AgentBoardQuery,
  AgentSettings,
  AgentSettingsInput,
  ToolCallView,
  Artifact,
  MemoryUsage,
} from '@my-pi-harness/protocol';
import type {
  EventInput,
  FrozenSkill,
  LiveMessageDelta,
  RequestAcceptance,
  QueueCapabilityMetadata,
  SessionCreateRecord,
  ProviderRecord,
} from '@my-pi-harness/protocol/internal';
import { StorageError } from '../shared/errors';
import { AuthRepository } from '../repositories/auth';
import { McpRepository } from '../repositories/mcp';
import { ExtensionRepository } from '../repositories/extensions';
import { RemoteMcpRepository } from '../repositories/remote-mcp';
import { ConnectionRepository } from '../repositories/connections';
import type { ProfileLock } from './profile-lock';
import { ProjectionWriter } from '../sessions/projections/projector';
import { WorkspaceRepository } from '../repositories/workspaces';
import { ModelSettingsRepository } from '../repositories/model-settings';
import { ToolProjection } from '../sessions/projections/tools';
import { WorkRepository } from '../sessions/projections/work';
import {
  SessionJournal,
  type SessionLogDownload,
  type StoredSessionEvent,
} from '../sessions/session-jsonl';
import { PrivateSessionFiles } from '../sessions/private-files';
import { AttachmentBlobs } from '../sessions/attachment-blobs';
import { agentInterruptionEvents } from '../sessions/agent-recovery';
import { ModelContextQuery } from '../sessions/model-context';
import type { ProfileStoreOptions } from './options';
import { SkillContextQuery } from '../sessions/skill-context';
import { AgentTaskQuery } from '../sessions/agent-tasks';
import { AgentSettingsRepository } from '../repositories/agent-settings';
import * as schema from '../sqlite/schema';

import { SessionEventCommit } from '../sessions/event-commit';
import { assertPersistentEvent } from '../sessions/event-persistence';
import { LiveMessages } from '../sessions/live-messages';
import { ArtifactBlobs, type ArtifactDownload, type ArtifactBlob } from '../artifacts/blobs';
import { ArtifactRepository } from '../artifacts/repository';
import { SessionQueries } from '../sessions/queries';
import { SessionRecovery } from '../sessions/recovery';
import { MemoryRepository } from '../memory/repository';
import { SearchRepository } from '../search/repository';

/** JSONL session facts, immutable attachments and SQLite configuration/projections for one daemon. */
export class ProfileStore {
  public readonly auth: AuthRepository;
  public readonly mcp: McpRepository;
  public readonly extensions: ExtensionRepository;
  public readonly remoteMcp: RemoteMcpRepository;
  public readonly connections: ConnectionRepository;
  public readonly memory: MemoryRepository;
  public readonly search: SearchRepository;
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly projector: ProjectionWriter;
  private readonly workspaces: WorkspaceRepository;
  private readonly modelSettings: ModelSettingsRepository;
  private readonly modelContext: ModelContextQuery;
  private readonly work: WorkRepository;
  private readonly agentTasks: AgentTaskQuery;
  private readonly agentSettings: AgentSettingsRepository;
  private readonly eventCommit: SessionEventCommit;
  private readonly live: LiveMessages;
  private readonly sessions: SessionQueries;
  private readonly artifacts: ArtifactRepository;
  private readonly skillContext: SkillContextQuery;
  private closed = false;
  private readonly files: PrivateSessionFiles;
  private readonly journal: SessionJournal;
  private readonly blobs: AttachmentBlobs;
  private readonly artifactBlobs: ArtifactBlobs;
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
    this.search = new SearchRepository(
      sqlite,
      (operation, readOnly) => this.transaction(operation, readOnly),
      () => this.auth.profileOwner()?.id,
    );
    this.memory = new MemoryRepository(
      sqlite,
      (operation, readOnly) => this.transaction(operation, readOnly),
      () => this.auth.profileOwner()?.id,
      (id) => this.search.forgetMemory(id),
    );
    this.db = drizzle(sqlite, { schema });
    this.projector = new ProjectionWriter(this.db);
    this.workspaces = new WorkspaceRepository(this.db);
    this.modelSettings = new ModelSettingsRepository(
      this.db,
      () => this.assertOpen(),
      (operation) => this.transaction(operation),
    );
    const tools = new ToolProjection(this.db);
    this.modelContext = new ModelContextQuery(this.db);
    this.skillContext = new SkillContextQuery(this.db);
    this.work = new WorkRepository(this.db);
    this.agentTasks = new AgentTaskQuery(this.db);
    this.agentSettings = new AgentSettingsRepository(this.db, options.defaultAgentSettings);
    this.eventCommit = new SessionEventCommit(
      this.db,
      this.projector,
      (record) => this.pendingRecords.push(record),
      this.workspaces,
    );
    this.live = new LiveMessages(this.db);
    this.sessions = new SessionQueries(this.db, this.projector, tools, this.live);
    this.files = new PrivateSessionFiles(lock.directory, options.sessionLogRoot);
    this.journal = new SessionJournal(this.files);
    this.blobs = new AttachmentBlobs(this.files);
    this.artifactBlobs = new ArtifactBlobs(this.files, options.artifactLimits);
    this.artifacts = new ArtifactRepository(this.db, this.artifactBlobs, (sessionId, toolId) =>
      this.getVisibleTool(sessionId, toolId),
    );
    try {
      const recovery = new SessionRecovery(
        this.db,
        this.projector,
        this.journal,
        this.blobs,
        this.artifactBlobs,
      );
      this.sqlite
        .transaction(() => {
          recovery.rebuild();
        })
        .immediate();
    } catch (error) {
      this.files.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('STORAGE_CLOSED', 'Storage is closed');
  }

  private transaction<T>(operation: () => T, readOnly = false): T {
    this.assertOpen();
    if (!readOnly && this.writeFailure) throw this.writeFailure;
    const outer = this.transactionDepth === 0;
    const previousLength = this.pendingRecords.length;
    let logged = false;
    this.transactionDepth += 1;
    try {
      const result = this.sqlite
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
      if (outer && logged) this.live.committed(this.pendingRecords.map(({ event }) => event));
      return result;
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
    this.live.clear();
    this.artifactBlobs.close();
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

  /** Host records retain private references; the gateway owns public credential status. */
  public listProviders(): ProviderRecord[] {
    return this.modelSettings.listProviders();
  }

  /** Read one provider configuration without retrieving secrets. */
  public getProvider(id: string): ProviderRecord | undefined {
    return this.modelSettings.getProvider(id);
  }

  /** Save a caller-incremented revision; computed credential flags are never durable facts. */
  public putProvider(input: ProviderRecord, expectedRevision?: number): ProviderRecord {
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
  public createSession(input: SessionCreateRecord): SessionSummary {
    this.files.validateId(input.id);
    return this.transaction(() => this.eventCommit.createSession(input));
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
    return this.sessions.getSession(id);
  }

  /** Latest bounded actual adoption for a Run in the selected root or task branch. */
  public getMemoryUsage(sessionId: string, runId: string): MemoryUsage | null {
    this.assertOpen();
    return this.work.memoryUsage(sessionId, runId);
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
    return this.sessions.listSessions();
  }

  /** Read every projection and its cursor atomically; messages follow selected branch history. */
  public getSnapshot(id: string): SessionSnapshot {
    return this.transaction(() => this.sessions.getSnapshot(id), true);
  }

  /** Read one tool visible in the current branch without loading either root or child transcripts. */
  public getVisibleTool(sessionId: string, toolId: string): ToolCallView | undefined {
    if (this.writeFailure) throw this.writeFailure;
    return this.transaction(() => this.sessions.getVisibleTool(sessionId, toolId), true);
  }

  /** Freeze exact host-read bytes before their metadata enters the session journal. */
  public putArtifactBytes(bytes: Uint8Array): ArtifactBlob {
    this.assertOpen();
    if (this.writeFailure) throw this.writeFailure;
    return this.artifactBlobs.put(bytes);
  }

  /** Only committed, currently visible root or child publications are downloadable. */
  public getArtifact(sessionId: string, artifactId: string): Artifact | undefined {
    return this.transaction(() => this.artifacts.get(sessionId, artifactId), true);
  }

  public listArtifacts(sessionId: string): Artifact[] {
    return this.transaction(() => this.artifacts.list(sessionId), true);
  }

  public acquireArtifactDownload(sessionId: string, artifactId: string): ArtifactDownload {
    const artifact = this.getArtifact(sessionId, artifactId);
    if (artifact === undefined)
      throw new StorageError('INVALID_RECORD', 'Artifact is not available in this session');
    return this.artifactBlobs.acquire(artifact);
  }

  /** Failed publications remain unreferenced; their bytes can be reclaimed after the operation settles. */
  public abandonArtifactPublication(hash: string): void {
    this.assertOpen();
    this.artifactBlobs.abandon(hash);
  }

  /** Archive and branch changes preserve every committed artifact reference. */
  public collectUnreferencedArtifacts(): number {
    this.assertOpen();
    return this.artifacts.collectUnreferenced();
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
    return this.work.compactions(sessionId, branchId ?? session.activeBranchId);
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
    return this.sessions.findRequest(sessionId, requestId);
  }

  /** Host-only frozen input authority; browser responses never receive this column. */
  public getQueuePrivateData(sessionId: string, inputId: string): QueueCapabilityMetadata | null {
    this.assertOpen();
    return this.sessions.getQueuePrivateData(sessionId, inputId);
  }

  /** Resolve pending input provenance from its immutable acceptance and original run. */
  public getQueueBranch(sessionId: string, inputId: string): string {
    this.assertOpen();
    return this.sessions.getQueueBranch(sessionId, inputId);
  }

  /** Return committed public records only; host codecs do not cross the event stream. */
  public readEvents(sessionId: string, afterSeq = 0, limit = 1000): HarnessEvent[] {
    this.assertOpen();
    return this.sessions.readEvents(sessionId, afterSeq, limit);
  }

  /** Append durable facts; transient output uses its separate process-local entry point. */
  public append(sessionId: string, inputs: readonly EventInput[]): HarnessEvent[] {
    for (const input of inputs) assertPersistentEvent(input.type);
    this.artifacts.validatePublications(inputs);
    const events = this.transaction(() => this.eventCommit.append(sessionId, inputs));
    this.artifacts.committed(events);
    return events;
  }

  /** Append live output without a SQLite transaction, durable cursor advance or journal write. */
  public publishMessageDelta(sessionId: string, delta: LiveMessageDelta): void {
    this.assertOpen();
    if (this.writeFailure) throw this.writeFailure;
    this.live.publish(sessionId, delta);
  }

  /** Return only complete branch messages with private replay codecs and canonical outcomes. */
  public getModelContext(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): Record<string, unknown>[] {
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
    return this.skillContext.read(sessionId, branchId, messageIds);
  }

  public getAgentSettings(): AgentSettings {
    this.assertOpen();
    return this.agentSettings.get();
  }

  public putAgentSettings(input: AgentSettingsInput): AgentSettings {
    return this.transaction(() => this.agentSettings.put(input));
  }

  public listAgentTasks(sessionId: string, branchId?: string): AgentTaskSummary[] {
    return this.transaction(() => this.agentTasks.list(sessionId, branchId), true);
  }

  public listAgentBoard(query: AgentBoardQuery = {}): AgentBoard {
    return this.transaction(() => this.agentTasks.board(query), true);
  }

  public getAgentTask(sessionId: string, taskId: string): AgentTaskSummary | undefined {
    return this.transaction(() => this.agentTasks.get(sessionId, taskId), true);
  }

  public findTaskBySource(
    sessionId: string,
    sourceToolCallId: string,
  ): AgentTaskSummary | undefined {
    this.assertOpen();
    return this.agentTasks.findBySource(sessionId, sourceToolCallId);
  }

  public getAgentTaskDetail(
    sessionId: string,
    taskId: string,
    cursor = 0,
    limit = 100,
  ): AgentTaskDetail {
    return this.transaction(() => {
      const detail = this.agentTasks.detail(sessionId, taskId, cursor, limit);
      return {
        ...detail,
        messages: this.live.merge(sessionId, detail.messages),
        liveRevision: this.live.revision(sessionId),
      };
    }, true);
  }

  public listAgentMessages(sessionId: string, target?: AgentMessageTarget): AgentMessage[] {
    return this.transaction(() => this.agentTasks.queue(sessionId, target), true);
  }

  public getTaskSnapshot(sessionId: string, taskId: string): SessionSnapshot {
    return this.transaction(() => {
      const snapshot = this.agentTasks.snapshot(sessionId, taskId);
      return {
        ...snapshot,
        messages: this.live.merge(sessionId, snapshot.messages),
        liveRevision: this.live.revision(sessionId),
      };
    }, true);
  }

  public getTaskWorkState(sessionId: string, taskId: string): WorkState {
    this.assertOpen();
    return this.work.getTask(sessionId, taskId);
  }

  public listTaskCompactions(sessionId: string, taskId: string): Compaction[] {
    this.assertOpen();
    const task = this.agentTasks.row(sessionId, taskId);
    return this.work.compactions(sessionId, task.branchId, taskId);
  }

  public getTaskCompactionContextStart(
    sessionId: string,
    taskId: string,
    compactionId: string,
  ): string | null {
    if (!this.listTaskCompactions(sessionId, taskId).some((version) => version.id === compactionId))
      throw new StorageError('INVALID_RECORD', 'Compaction does not belong to this task');
    return this.work.compactionContextStart(sessionId, compactionId);
  }

  public getTaskModelContext(
    sessionId: string,
    taskId: string,
    messageIds?: readonly string[],
  ): Record<string, unknown>[] {
    this.assertOpen();
    return this.modelContext.readTask(sessionId, taskId, messageIds);
  }

  /** Preserve partial output and queue; stale resources become interrupted, never retried. */
  public recoverInterrupted(): HarnessEvent[] {
    const output: HarnessEvent[] = [];
    for (const session of this.listSessions()) {
      const at = Date.now();
      const inputs = agentInterruptionEvents(this.db, session, at);
      if (inputs.length > 0) output.push(...this.append(session.id, inputs));
    }
    return output;
  }
}
