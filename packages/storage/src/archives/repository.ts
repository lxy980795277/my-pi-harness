import type Database from 'better-sqlite3';
import { existsSync, linkSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { Type, type Static } from 'typebox';
import {
  SessionArchiveImportReceiptSchema,
  SessionArchiveImportBindingSchema,
  SessionArchivePreviewSchema,
  SessionArchiveManifestSchema,
  AttachmentContentSchema,
  WorkspaceSchema,
  type SessionArchiveImportReceipt,
  type SessionArchivePreview,
  type SessionArchiveManifest,
  type SessionArchiveImportBinding,
  type SessionExecutionAccess,
} from '@my-pi-harness/protocol';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import type { PrivateSessionFiles } from '../sessions/private-files';
import type { SessionJournal } from '../sessions/session-jsonl';
import type { AttachmentBlobs } from '../sessions/attachment-blobs';
import type { ArtifactBlobs } from '../artifacts/blobs';
import { archiveClosure, collectArchiveRecord, archiveDependencies } from './closure';
import {
  ArchiveFiles,
  copyArchiveFile,
  managedFile,
  openOwnedFile,
  hashArchiveFile,
  syncDirectory,
  archivePath,
  readArchiveBytes,
} from './files';
import {
  stageArchive,
  sealArchive,
  archiveJournalHash,
  validateManifest,
  type ArchiveValidation,
} from './validation';
import { traceSession } from '../sessions/trace-scope';
import { sessionExecutionAccess } from '../sessions/import-access';
import type { EventInput } from '@my-pi-harness/protocol/internal';
import type {
  SessionArchiveInput,
  SessionArchiveSource,
  SessionArchiveOptions,
  SessionArchiveImportsQuery,
} from './types';

interface ArchiveHost {
  db: Database.Database;
  files: PrivateSessionFiles;
  journal: SessionJournal;
  blobs: AttachmentBlobs;
  artifactBlobs: ArtifactBlobs;
  ownerUserId(): string | null;
  append(sessionId: string, inputs: readonly EventInput[]): void;
  replay(sessionId: string, attachmentIds: readonly string[]): void;
}
type PublicationPlan = NonNullable<Static<typeof storedReceipt>['plan']>;
interface InflightImport {
  archiveSha256: string;
  promise: Promise<SessionArchiveImportReceipt>;
}
interface Conflict {
  kind: string;
  id: string;
}
interface Conflicts {
  count: number;
  items: Conflict[];
}
const receiptRow = Type.Object({ data: Type.String() });
const idRow = Type.Object({ id: Type.String() });
const workspaceRow = Type.Object({ data: Type.String() });
const storedReceipt = Type.Object(
  {
    receipt: SessionArchiveImportReceiptSchema,
    plan: Type.Union([
      Type.Object(
        {
          stage: Type.String(),
          manifest: SessionArchiveManifestSchema,
          journal: Type.Object(
            {
              path: Type.String(),
              bytes: Type.Integer({ minimum: 1 }),
              sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
const idDomains = [
  ['sessions', 'id'],
  ['branches', 'id'],
  ['runs', 'id'],
  ['messages', 'id'],
  ['tool_calls', 'id'],
  ['agent_tasks', 'id'],
  ['artifacts', 'id'],
  ['queued_inputs', 'id'],
  ['agent_messages', 'id'],
  ['checkpoints', 'id'],
  ['events', 'event_id'],
  ['file_operations', 'id'],
  ['file_change_batches', 'id'],
  ['request_snapshots', 'model_request_id'],
] as const;

/** Complete single-session archives preserve history and resources, never local execution grants. */
export class SessionArchiveRepository {
  private readonly archiveFiles: ArchiveFiles;
  private readonly inflight = new Map<string, InflightImport>();
  public constructor(private readonly host: ArchiveHost) {
    this.archiveFiles = new ArchiveFiles(join(host.files.directory, 'archives'));
  }

  public async create(
    sessionId: string,
    options: SessionArchiveOptions = {},
  ): Promise<SessionArchiveSource> {
    const session = traceSession(this.host.db, sessionId);
    const snapshotSeq = session.snapshotSeq;
    const closure = archiveClosure();
    const releases: Array<() => void> = [];
    let download: ReturnType<SessionJournal['openDownload']> | undefined;
    const stage = this.archiveFiles.createStage();
    const entries: SessionArchiveManifest['entries'] = [];
    let totalBytes = 0;
    let complete = false;
    try {
      download = this.host.journal.openDownload(sessionId);
      for (const records of this.host.journal.read(sessionId))
        for (const record of records) {
          if (record.event.seq > snapshotSeq) break;
          collectArchiveRecord(closure, record);
        }
      for (const hash of closure.blobs.keys()) releases.push(this.host.artifactBlobs.retain(hash));
      const add = async (
        path: string,
        kind: SessionArchiveManifest['entries'][number]['kind'],
        stream: Readable,
        expected?: { bytes: number; sha256: string },
      ) => {
        if (entries.length >= 20000)
          throw new StorageError('ARCHIVE_INVALID', 'Archive contains too many resources');
        const file = managedFile(stage, path);
        const result = await copyArchiveFile(stream, file, expected, options.signal);
        entries.push({ path, kind, ...result });
        totalBytes += result.bytes;
        if (totalBytes > 2 * 1024 * 1024 * 1024)
          throw new StorageError(
            'ARCHIVE_INVALID',
            'Archive exceeds its total uncompressed byte limit',
          );
      };
      await add('session.jsonl', 'journal', download.content);
      for (const id of closure.attachments) {
        const content = this.host.blobs.read(id);
        if (content === undefined)
          throw new StorageError('ARCHIVE_INVALID', 'A referenced attachment is missing');
        await add(
          `attachments/${id}.json`,
          'attachment',
          Readable.from([Buffer.from(JSON.stringify(content))]),
        );
      }
      for (const [hash, bytes] of closure.blobs)
        await add(
          `blobs/${hash}.blob`,
          'blob',
          openOwnedFile(join(this.host.files.artifactDirectory, `${hash}.blob`)),
          { sha256: hash, bytes },
        );
      for (const [hash, skill] of closure.skills) {
        if (skill.resources.length === 0) continue;
        const imported = join(this.archiveFiles.resources, hash);
        const local = options.resolveSkillDirectory?.(skill);
        const directory =
          local !== undefined && existsSync(local)
            ? local
            : existsSync(imported)
              ? imported
              : local;
        if (directory === undefined)
          throw new StorageError(
            'ARCHIVE_INVALID',
            'The host cannot locate a frozen Skill resource version',
          );
        const root = lstatSync(directory);
        if (!root.isDirectory() || root.isSymbolicLink() || realpathSync(directory) !== directory)
          throw new StorageError('ARCHIVE_INVALID', 'Frozen Skill resource directory is missing');
        for (const resource of skill.resources) {
          let parent = directory;
          for (const part of resource.path.split('/').slice(0, -1)) {
            parent = join(parent, part);
            const status = lstatSync(parent);
            if (!status.isDirectory() || status.isSymbolicLink())
              throw new StorageError('ARCHIVE_INVALID', 'Frozen Skill resource parent is invalid');
          }
          await add(
            `skills/${hash}/${resource.path}`,
            'skill',
            openOwnedFile(join(directory, ...resource.path.split('/'))),
            { sha256: resource.hash, bytes: resource.size },
          );
        }
      }
      const workspace =
        session.workspaceId === null
          ? null
          : this.host.db.prepare('SELECT data FROM workspaces WHERE id=?').get(session.workspaceId);
      const name =
        workspace === undefined || workspace === null
          ? '历史工作区'
          : checked(WorkspaceSchema, JSON.parse(checked(workspaceRow, workspace).data)).name.slice(
              0,
              200,
            );
      const manifest = checked(SessionArchiveManifestSchema, {
        formatVersion: 1,
        sessionId,
        title: session.title,
        snapshotSeq,
        createdAt: Date.now(),
        activeAtSnapshot: session.activeRunId !== null,
        entries,
        dependencies: archiveDependencies(
          closure,
          session.workspaceId === null ? null : { workspaceId: session.workspaceId, name },
        ),
      });
      if (Buffer.byteLength(JSON.stringify(manifest)) > 8 * 1024 * 1024)
        throw new StorageError('ARCHIVE_INVALID', 'Archive manifest exceeds its metadata limit');
      complete = true;
      let released = false;
      return {
        manifest,
        entries: entries.map((entry) => ({
          ...entry,
          open: () => {
            if (released)
              throw new StorageError('ARCHIVE_NOT_FOUND', 'Archive source has been released');
            return openOwnedFile(join(stage, ...entry.path.split('/')));
          },
        })),
        release: () => {
          if (released) return;
          released = true;
          this.archiveFiles.removeStage(stage);
        },
      };
    } finally {
      download?.content.destroy();
      for (const release of releases) release();
      if (!complete) this.archiveFiles.removeStage(stage);
    }
  }

  private conflicts(value: ArchiveValidation): Conflicts {
    const result: Conflicts = { count: 0, items: [] };
    const add = (kind: string, id: string) => {
      result.count++;
      if (result.items.length < 100) result.items.push({ kind, id });
    };
    for (const [table, column] of idDomains) {
      const find = this.host.db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`);
      for (const row of value.db.prepare(`SELECT ${column} AS id FROM ${table}`).iterate()) {
        const id = checked(idRow, row).id;
        if (find.get(id) !== undefined) add(table, id);
      }
    }
    for (const [sourceTable, targetTable] of [
      ['file_operations', 'file_change_batches'],
      ['file_change_batches', 'file_operations'],
    ] as const) {
      for (const row of value.db.prepare(`SELECT id FROM ${sourceTable}`).iterate()) {
        const id = checked(idRow, row).id;
        if (
          this.host.db.prepare(`SELECT 1 FROM ${targetTable} WHERE id=?`).get(id) !== undefined ||
          value.db.prepare(`SELECT 1 FROM ${targetTable} WHERE id=?`).get(id) !== undefined
        )
          add('file_operations', id);
      }
    }
    for (const id of value.closure.attachments) {
      const existing = this.host.blobs.read(id);
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(value.blobs.read(id))
      )
        add('attachments', id);
    }
    return result;
  }

  private publicationCapacity(value: ArchiveValidation): void {
    this.host.artifactBlobs.assertPublicationCapacity(
      [...value.closure.blobs].map(([sha256, bytes]) => ({ sha256, bytes })),
    );
    for (const entry of value.manifest.entries)
      if (entry.kind === 'skill') {
        const parts = entry.path.slice(7).split('/');
        let path = this.archiveFiles.resources;
        for (const part of parts) {
          path = join(path, part);
          try {
            const status = lstatSync(path);
            if (status.isSymbolicLink())
              throw new StorageError(
                'ARCHIVE_INVALID',
                'Imported Skill resource path contains a link',
              );
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
            throw error;
          }
        }
        const target = join(this.archiveFiles.resources, ...parts);
        if (existsSync(target)) readArchiveBytes(target, entry);
      }
  }

  private previewValue(value: ArchiveValidation, archiveSha256: string): SessionArchivePreview {
    this.publicationCapacity(value);
    const { entries, ...manifest } = value.manifest;
    const conflicts = this.conflicts(value);
    return checked(SessionArchivePreviewSchema, {
      archiveSha256,
      manifest: {
        ...manifest,
        entryCount: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      },
      canImport: conflicts.count === 0,
      conflictCount: conflicts.count,
      conflicts: conflicts.items,
      warnings: [
        '历史授权和待执行操作不会恢复；继续对话前需绑定本机执行依赖。',
        '归档保留已冻结的私有历史和附件内容；未留存的原始办公文件不包含在内。',
      ],
    });
  }

  public async preview(
    input: SessionArchiveInput,
    archiveSha256: string,
    options: Pick<SessionArchiveOptions, 'signal'> = {},
  ): Promise<SessionArchivePreview> {
    const stage = this.archiveFiles.createStage();
    let value: ArchiveValidation | undefined;
    try {
      value = await stageArchive(input, stage, this.archiveFiles.resources, options.signal);
      return this.previewValue(value, archiveSha256);
    } finally {
      value?.close();
      this.archiveFiles.removeStage(stage);
    }
  }

  public get(operationId: string): SessionArchiveImportReceipt | undefined {
    const stored = this.archiveFiles.existingReceipt(operationId);
    if (stored === undefined) return undefined;
    const value = checked(storedReceipt, stored).receipt;
    if (value.operationId !== operationId)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Import receipt identifier does not match its owned filename',
      );
    return value;
  }

  public executionAccess(sessionId: string): SessionExecutionAccess {
    traceSession(this.host.db, sessionId);
    return sessionExecutionAccess(this.host.db, sessionId);
  }

  public bind(
    sessionId: string,
    binding: SessionArchiveImportBinding,
    at: number,
  ): SessionExecutionAccess {
    checked(SessionArchiveImportBindingSchema, binding);
    const session = traceSession(this.host.db, sessionId);
    if (this.executionAccess(sessionId).importedThroughSeq === null)
      throw new StorageError('CONFLICT', 'Only imported history uses execution dependency binding');
    if (session.activeRunId !== null)
      throw new StorageError('CONFLICT', 'Cannot bind dependencies during an active run');
    if (
      this.host.db.prepare('SELECT 1 FROM provider_configs WHERE id=?').get(binding.providerId) ===
      undefined
    )
      throw new StorageError('PROVIDER_NOT_FOUND', 'Current provider does not exist');
    if (
      binding.workspaceId !== null &&
      this.host.db
        .prepare('SELECT 1 FROM workspaces WHERE id=? AND archived=0')
        .get(binding.workspaceId) === undefined
    )
      throw new StorageError('WORKSPACE_NOT_FOUND', 'Current workspace does not exist');
    this.host.append(sessionId, [
      { type: 'session.execution_bound', runId: null, at, data: binding },
    ]);
    return this.executionAccess(sessionId);
  }

  public references(): Set<string> {
    const references = new Set<string>();
    for (const row of this.host.db
      .prepare(
        `SELECT data FROM session_archive_imports WHERE json_extract(data,'$.status')='publishing'`,
      )
      .all()) {
      const receipt = checked(
        SessionArchiveImportReceiptSchema,
        JSON.parse(checked(receiptRow, row).data),
      );
      const stored = checked(storedReceipt, this.archiveFiles.existingReceipt(receipt.operationId));
      if (stored.plan !== null)
        for (const entry of stored.plan.manifest.entries)
          if (entry.kind === 'blob') references.add(entry.sha256);
    }
    return references;
  }

  public list(query: SessionArchiveImportsQuery = {}): SessionArchiveImportReceipt[] {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 51)
      throw new StorageError('ARCHIVE_INVALID', 'Archive receipt page limit is invalid');
    const before = query.before;
    const rows = this.host.db
      .prepare(
        'SELECT data FROM session_archive_imports WHERE created_at<? OR created_at=? AND id<? ORDER BY created_at DESC,id DESC LIMIT ?',
      )
      .all(
        before?.createdAt ?? Number.MAX_SAFE_INTEGER,
        before?.createdAt ?? Number.MAX_SAFE_INTEGER,
        before?.operationId ?? '\uffff',
        limit,
      );
    return rows.map((row) =>
      checked(SessionArchiveImportReceiptSchema, JSON.parse(checked(receiptRow, row).data)),
    );
  }

  private save(receipt: SessionArchiveImportReceipt, plan: unknown): void {
    checked(SessionArchiveImportReceiptSchema, receipt);
    this.archiveFiles.writeReceipt(receipt.operationId, { receipt, plan });
    this.host.db
      .prepare(
        'INSERT INTO session_archive_imports(id,archive_sha256,created_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(receipt.operationId, receipt.archiveSha256, receipt.createdAt, JSON.stringify(receipt));
  }

  public import(
    operationId: string,
    input: SessionArchiveInput,
    archiveSha256: string,
    options: Pick<SessionArchiveOptions, 'signal'> = {},
  ): Promise<SessionArchiveImportReceipt> {
    const active = this.inflight.get(operationId);
    if (active !== undefined) {
      if (active.archiveSha256 !== archiveSha256)
        return Promise.reject(
          new StorageError(
            'ARCHIVE_CONFLICT',
            'Import operation ID belongs to a different archive',
          ),
        );
      return active.promise;
    }
    const promise = this.importOnce(operationId, input, archiveSha256, options).finally(() =>
      this.inflight.delete(operationId),
    );
    this.inflight.set(operationId, { archiveSha256, promise });
    return promise;
  }

  private async importOnce(
    operationId: string,
    input: SessionArchiveInput,
    archiveSha256: string,
    options: Pick<SessionArchiveOptions, 'signal'> = {},
  ): Promise<SessionArchiveImportReceipt> {
    const previous = this.get(operationId);
    if (previous !== undefined) {
      if (previous.archiveSha256 !== archiveSha256)
        throw new StorageError(
          'ARCHIVE_CONFLICT',
          'Import operation ID belongs to a different archive',
        );
      return previous;
    }
    checked(SessionArchiveImportReceiptSchema, {
      operationId,
      archiveSha256,
      sessionId: input.manifest.sessionId,
      status: 'publishing',
      createdAt: 0,
      updatedAt: 0,
      error: null,
    });
    const stage = this.archiveFiles.createStage();
    let value: ArchiveValidation | undefined;
    let publishing = false;
    try {
      value = await stageArchive(input, stage, this.archiveFiles.resources, options.signal);
      if (this.conflicts(value).count !== 0)
        throw new StorageError(
          'ARCHIVE_CONFLICT',
          'Archive identifiers conflict with existing profile history',
        );
      const now = Date.now();
      sealArchive(value, operationId, archiveSha256, this.host.ownerUserId(), now);
      const journal = await archiveJournalHash(value, options.signal);
      options.signal?.throwIfAborted();
      const accepted = this.get(operationId);
      if (accepted !== undefined) {
        if (accepted.archiveSha256 !== archiveSha256)
          throw new StorageError(
            'ARCHIVE_CONFLICT',
            'Import operation ID belongs to a different archive',
          );
        return accepted;
      }
      if (this.conflicts(value).count !== 0)
        throw new StorageError('ARCHIVE_CONFLICT', 'Archive identifiers changed during staging');
      this.publicationCapacity(value);
      const receipt: SessionArchiveImportReceipt = {
        operationId,
        archiveSha256,
        sessionId: value.manifest.sessionId,
        status: 'publishing',
        createdAt: now,
        updatedAt: now,
        error: null,
      };
      const plan = {
        stage: relative(this.archiveFiles.staging, stage),
        manifest: value.manifest,
        journal: {
          path: relative(stage, journal.path),
          bytes: journal.bytes,
          sha256: journal.sha256,
        },
      };
      value.close();
      value = undefined;
      publishing = true;
      this.save(receipt, plan);
      this.publish(receipt, plan);
      this.host.replay(
        receipt.sessionId,
        input.manifest.entries
          .filter((entry) => entry.kind === 'attachment')
          .map((entry) => entry.path.slice(12, -5)),
      );
      const completed: SessionArchiveImportReceipt = {
        ...receipt,
        status: 'completed',
        updatedAt: Date.now(),
      };
      this.save(completed, null);
      this.archiveFiles.removeStage(stage);
      return completed;
    } catch (cause) {
      if (publishing)
        throw new StorageError(
          'SESSION_LOG_UNAVAILABLE',
          'Import publication is not confirmed; restart and query the same operation ID',
          { cause },
        );
      throw cause;
    } finally {
      value?.close();
      if (!publishing) this.archiveFiles.removeStage(stage);
    }
  }

  /** Resume only owned resource/journal publication; no model, tool or workspace operation is replayed. */
  public recoverPublications(): void {
    for (const row of this.host.db.prepare('SELECT id FROM session_archive_imports').all()) {
      const id = checked(idRow, row).id;
      if (this.archiveFiles.existingReceipt(id) === undefined)
        throw new StorageError('ARCHIVE_INVALID', 'An indexed durable import receipt is missing');
    }
    this.host.db.exec('DELETE FROM session_archive_imports');
    for (const name of this.archiveFiles.receiptNames()) {
      const stored = checked(
        storedReceipt,
        this.archiveFiles.readReceiptPath(join(this.archiveFiles.root, 'receipts', name)),
      );
      if (
        this.archiveFiles.receiptPath(stored.receipt.operationId) !==
        join(this.archiveFiles.root, 'receipts', name)
      )
        throw new StorageError(
          'ARCHIVE_INVALID',
          'Import receipt identifier does not match its owned filename',
        );
      this.host.db
        .prepare(
          'INSERT INTO session_archive_imports(id,archive_sha256,created_at,data) VALUES(?,?,?,?)',
        )
        .run(
          stored.receipt.operationId,
          stored.receipt.archiveSha256,
          stored.receipt.createdAt,
          JSON.stringify(stored.receipt),
        );
      if (stored.receipt.status === 'publishing') {
        if (stored.plan === null)
          throw new StorageError('ARCHIVE_INVALID', 'Publishing import has no owned recovery plan');
        try {
          this.publish(stored.receipt, stored.plan);
        } catch (cause) {
          if (existsSync(join(this.host.files.directory, `${stored.receipt.sessionId}.jsonl`)))
            throw cause;
          this.save(
            {
              ...stored.receipt,
              status: 'failed',
              updatedAt: Date.now(),
              error: 'Import staging could not be verified; no session journal was published',
            },
            null,
          );
          this.archiveFiles.removeStage(join(this.archiveFiles.staging, stored.plan.stage));
        }
      }
    }
  }

  public cleanupStages(): void {
    const retained = new Set<string>();
    for (const name of this.archiveFiles.receiptNames()) {
      const stored = checked(
        storedReceipt,
        this.archiveFiles.readReceiptPath(join(this.archiveFiles.root, 'receipts', name)),
      );
      if (stored.plan !== null) retained.add(stored.plan.stage);
    }
    for (const name of this.archiveFiles.stageNames())
      if (!retained.has(name)) this.archiveFiles.removeStage(join(this.archiveFiles.staging, name));
  }

  public finishRecovery(): void {
    for (const row of this.host.db
      .prepare(
        `SELECT data FROM session_archive_imports WHERE json_extract(data,'$.status')='publishing'`,
      )
      .all()) {
      const receipt = checked(
        SessionArchiveImportReceiptSchema,
        JSON.parse(checked(receiptRow, row).data),
      );
      const stored = checked(storedReceipt, this.archiveFiles.existingReceipt(receipt.operationId));
      if (
        this.host.db.prepare('SELECT 1 FROM sessions WHERE id=?').get(receipt.sessionId) ===
        undefined
      )
        throw new StorageError('ARCHIVE_INVALID', 'Published import has no recovered session');
      this.save({ ...receipt, status: 'completed', updatedAt: Date.now() }, null);
      if (stored.plan !== null)
        this.archiveFiles.removeStage(join(this.archiveFiles.staging, stored.plan.stage));
    }
  }

  private publish(receipt: SessionArchiveImportReceipt, plan: PublicationPlan): void {
    validateManifest(plan.manifest);
    archivePath(plan.journal.path);
    if (receipt.sessionId !== plan.manifest.sessionId)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Import publication plan changed its session identity',
      );
    if (!/^stage-[a-f0-9-]{36}$/.test(plan.stage))
      throw new StorageError('ARCHIVE_INVALID', 'Import recovery staging identifier is invalid');
    const stage = join(this.archiveFiles.staging, plan.stage);
    const payload = join(stage, 'payload');
    const journalTarget = join(this.host.files.directory, `${receipt.sessionId}.jsonl`);
    for (const entry of plan.manifest.entries) {
      if (entry.kind === 'journal') continue;
      const source = join(payload, ...entry.path.split('/'));
      if (entry.kind === 'skill') {
        const target = managedFile(this.archiveFiles.resources, entry.path.slice(7));
        if (existsSync(source) && existsSync(target)) {
          const sourceStat = lstatSync(source),
            targetStat = lstatSync(target);
          if (
            sourceStat.isFile() &&
            targetStat.isFile() &&
            !sourceStat.isSymbolicLink() &&
            !targetStat.isSymbolicLink() &&
            sourceStat.dev === targetStat.dev &&
            sourceStat.ino === targetStat.ino &&
            sourceStat.nlink === 2
          )
            unlinkSync(source);
        }
        if (existsSync(target)) {
          readArchiveBytes(target, entry);
          continue;
        }
        readArchiveBytes(source, entry);
        linkSync(source, target);
        syncDirectory(join(target, '..'));
        unlinkSync(source);
        syncDirectory(join(source, '..'));
        continue;
      }
      const sourceBytes = readArchiveBytes(source, entry);
      if (entry.kind === 'attachment') {
        const content = checked(AttachmentContentSchema, JSON.parse(sourceBytes.toString('utf8')));
        const existing = this.host.blobs.read(content.attachment.id);
        if (existing === undefined) this.host.blobs.put(content);
        else if (JSON.stringify(existing) !== JSON.stringify(content))
          throw new StorageError('ARCHIVE_CONFLICT', 'Import attachment ID is already used');
      } else {
        const blob = this.host.artifactBlobs.put(sourceBytes, { allowEmpty: true });
        if (blob.sha256 !== entry.sha256 || blob.bytes !== entry.bytes)
          throw new StorageError(
            'ARCHIVE_INVALID',
            'Staged archive blob changed before publication',
          );
        this.host.artifactBlobs.abandon(blob.sha256);
      }
    }
    const stagedJournal = join(stage, plan.journal.path);
    if (existsSync(journalTarget) && existsSync(stagedJournal)) {
      const targetStat = lstatSync(journalTarget),
        stageStat = lstatSync(stagedJournal);
      if (
        targetStat.isFile() &&
        !targetStat.isSymbolicLink() &&
        targetStat.dev === stageStat.dev &&
        targetStat.ino === stageStat.ino &&
        targetStat.nlink === 2
      )
        unlinkSync(stagedJournal);
    }
    if (existsSync(journalTarget)) {
      // A published target is accepted only when the immutable owned plan names these exact bytes.
      const actual = hashArchiveFile(journalTarget);
      if (actual.sha256 !== plan.journal.sha256 || actual.bytes !== plan.journal.bytes)
        throw new StorageError(
          'ARCHIVE_CONFLICT',
          'Imported session journal conflicts with an existing session',
        );
    } else {
      const actual = hashArchiveFile(stagedJournal);
      if (actual.sha256 !== plan.journal.sha256 || actual.bytes !== plan.journal.bytes)
        throw new StorageError(
          'ARCHIVE_INVALID',
          'Staged import journal changed before publication',
        );
      linkSync(stagedJournal, journalTarget);
      this.host.files.syncDirectory(this.host.files.directory);
      unlinkSync(stagedJournal);
      syncDirectory(join(stagedJournal, '..'));
    }
  }
}
