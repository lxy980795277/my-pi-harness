import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import {
  AttachmentContentSchema,
  SessionArchiveManifestSchema,
  SessionSummarySchema,
  FileChangeBatchReceiptSchema,
  type SessionArchiveManifest,
  type SessionSummary,
} from '@my-pi-harness/protocol';
import type { EventInput } from '@my-pi-harness/protocol/internal';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import { applyMigrations } from '../sqlite/migrations/apply';
import * as schema from '../sqlite/schema';
import { PrivateSessionFiles } from '../sessions/private-files';
import { SessionJournal, type StoredSessionEvent } from '../sessions/session-jsonl';
import { AttachmentBlobs } from '../sessions/attachment-blobs';
import { ArtifactBlobs } from '../artifacts/blobs';
import { ProjectionWriter } from '../sessions/projections/projector';
import { ExecutionUsageQuery } from '../sessions/execution-usage';
import { SessionRecovery } from '../sessions/recovery';
import { SessionEventCommit } from '../sessions/event-commit';
import { WorkspaceRepository } from '../repositories/workspaces';
import { agentInterruptionEvents } from '../sessions/agent-recovery';
import {
  archiveClosure,
  collectArchiveRecord,
  mapArchiveRecord,
  requiredArchivePaths,
  archiveDependencies,
  type ArchiveClosure,
} from './closure';
import { archivePath, managedFile, copyArchiveFile, ownedDirectory, openOwnedFile } from './files';
import type { SessionArchiveInput } from './types';

export interface ArchiveValidation {
  directory: string;
  staged: Map<string, string>;
  manifest: SessionArchiveManifest;
  closure: ArchiveClosure;
  db: Database.Database;
  orm: BetterSQLite3Database<typeof schema>;
  files: PrivateSessionFiles;
  journal: SessionJournal;
  blobs: AttachmentBlobs;
  artifactBlobs: ArtifactBlobs;
  recovery: SessionRecovery;
  append(inputs: readonly EventInput[]): void;
  session(): SessionSummary;
  close(): void;
}
const dataRow = Type.Object({ data: Type.String() });
const idRow = Type.Object({ id: Type.String() });
const operationRow = Type.Object({
  id: Type.String(),
  run_id: Type.Union([Type.String(), Type.Null()]),
});

export function validateManifest(input: SessionArchiveManifest): SessionArchiveManifest {
  const manifest = checked(SessionArchiveManifestSchema, input);
  if (
    !/^[A-Za-z0-9_-]{1,160}$/.test(manifest.sessionId) ||
    Buffer.byteLength(JSON.stringify(manifest)) > 8 * 1024 * 1024
  )
    throw new StorageError(
      'ARCHIVE_INVALID',
      'Archive manifest exceeds its supported metadata limit',
    );
  let total = 0;
  const paths = new Set<string>();
  for (const entry of manifest.entries) {
    archivePath(entry.path);
    const maximum =
      entry.kind === 'attachment'
        ? 4 * 1024 * 1024
        : entry.kind === 'blob'
          ? 33554432
          : entry.kind === 'skill'
            ? 16 * 1024 * 1024
            : 512 * 1024 * 1024;
    if (entry.bytes > maximum)
      throw new StorageError('ARCHIVE_INVALID', 'Archive resource exceeds its codec byte limit');
    if (paths.has(entry.path))
      throw new StorageError('ARCHIVE_INVALID', 'Archive contains duplicate entries');
    paths.add(entry.path);
    total += entry.bytes;
    const valid =
      entry.kind === 'journal'
        ? entry.path === 'session.jsonl'
        : entry.kind === 'attachment'
          ? /^attachments\/[A-Za-z0-9_-]{1,160}\.json$/.test(entry.path)
          : entry.kind === 'blob'
            ? /^blobs\/[a-f0-9]{64}\.blob$/.test(entry.path)
            : /^skills\/[a-f0-9]{64}\/.+/.test(entry.path);
    if (!valid)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive entry category does not match its managed path',
      );
  }
  if (
    total > 2 * 1024 * 1024 * 1024 ||
    !paths.has('session.jsonl') ||
    manifest.entries.filter((entry) => entry.kind === 'journal').length !== 1
  )
    throw new StorageError(
      'ARCHIVE_INVALID',
      'Archive resource closure or total byte limit is invalid',
    );
  return manifest;
}

function validationStorage(directory: string) {
  let rawFiles: PrivateSessionFiles | undefined,
    files: PrivateSessionFiles | undefined,
    db: Database.Database | undefined,
    artifactBlobs: ArtifactBlobs | undefined;
  try {
    const rawRoot = join(directory, 'raw');
    ownedDirectory(rawRoot);
    rawFiles = new PrivateSessionFiles(rawRoot);
    const rawJournal = new SessionJournal(rawFiles);
    const mappedRoot = join(directory, 'mapped');
    ownedDirectory(mappedRoot);
    files = new PrivateSessionFiles(mappedRoot);
    const journal = new SessionJournal(files);
    db = new Database(':memory:');
    db.pragma('foreign_keys=ON');
    applyMigrations(db);
    const orm = drizzle(db, { schema });
    const blobs = new AttachmentBlobs(files);
    artifactBlobs = new ArtifactBlobs(files, {
      maximumFileBytes: 33554432,
      maximumProfileBytes: 2147483648,
    });
    const usage = new ExecutionUsageQuery(db);
    const projector = new ProjectionWriter(orm, db, usage);
    const recovery = new SessionRecovery(orm, projector, journal, blobs, artifactBlobs);
    return {
      rawFiles,
      rawJournal,
      files,
      journal,
      db,
      orm,
      blobs,
      artifactBlobs,
      projector,
      recovery,
    };
  } catch (cause) {
    artifactBlobs?.close();
    files?.close();
    rawFiles?.close();
    db?.close();
    throw cause;
  }
}

/** Parse original codecs incrementally, map host identities, then reuse every production projection validator. */
export async function stageArchive(
  input: SessionArchiveInput,
  directory: string,
  resourcesRoot: string,
  signal?: AbortSignal,
): Promise<ArchiveValidation> {
  const manifest = validateManifest(input.manifest);
  const staged = new Map<string, string>();
  const entryMap = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const {
    rawFiles,
    rawJournal,
    files,
    journal,
    db,
    orm,
    blobs,
    artifactBlobs,
    projector,
    recovery,
  } = validationStorage(directory);
  let finished = false;
  try {
    const payloadRoot = join(directory, 'payload');
    ownedDirectory(payloadRoot);
    for (const entry of manifest.entries) {
      signal?.throwIfAborted();
      const path = managedFile(payloadRoot, entry.path);
      await copyArchiveFile(input.open(entry.path), path, entry, signal);
      staged.set(entry.path, path);
    }
    const rawPath = staged.get('session.jsonl');
    if (rawPath === undefined)
      throw new StorageError('ARCHIVE_INVALID', 'Archive has no session journal');
    renameSync(rawPath, join(rawFiles.directory, `${manifest.sessionId}.jsonl`));
    chmodSync(join(rawFiles.directory, `${manifest.sessionId}.jsonl`), 0o600);
    const closure = archiveClosure();
    const revisions = new Map<string, number>();
    let seq = 0;
    for (const records of rawJournal.read(manifest.sessionId)) {
      signal?.throwIfAborted();
      for (const record of records) {
        collectArchiveRecord(closure, record);
        seq = record.event.seq;
      }
      journal.append(
        manifest.sessionId,
        records.map((record) => mapArchiveRecord(record, resourcesRoot, revisions)),
      );
    }
    if (
      statSync(join(rawFiles.directory, `${manifest.sessionId}.jsonl`)).size !==
      manifest.entries.find((entry) => entry.kind === 'journal')?.bytes
    )
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive journal has an incomplete or non-canonical tail',
      );
    staged.set('session.jsonl', join(files.directory, `${manifest.sessionId}.jsonl`));
    if (seq !== manifest.snapshotSeq)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive cursor does not match its complete journal prefix',
      );
    const required = requiredArchivePaths(closure);
    if (
      required.size !== manifest.entries.length ||
      manifest.entries.some((entry) => !required.has(entry.path))
    )
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive contains missing or unreachable resources',
      );
    for (const id of closure.attachments) {
      const path = staged.get(`attachments/${id}.json`);
      if (path === undefined)
        throw new StorageError('ARCHIVE_INVALID', 'Referenced attachment is missing');
      const content = checked(AttachmentContentSchema, JSON.parse(readFileSync(path, 'utf8')));
      if (content.attachment.id !== id)
        throw new StorageError(
          'ARCHIVE_INVALID',
          'Attachment identity does not match its archive path',
        );
      blobs.put(content);
    }
    for (const [hash, size] of closure.blobs) {
      const entry = entryMap.get(`blobs/${hash}.blob`);
      if (entry?.sha256 !== hash || entry.bytes !== size)
        throw new StorageError(
          'ARCHIVE_INVALID',
          'Referenced blob identity does not match its archive entry',
        );
      const path = staged.get(entry.path);
      if (path === undefined)
        throw new StorageError('ARCHIVE_INVALID', 'Referenced blob is missing');
      const blob = artifactBlobs.put(readFileSync(path), { allowEmpty: true });
      artifactBlobs.abandon(blob.sha256);
    }
    for (const [hash, skill] of closure.skills)
      for (const resource of skill.resources) {
        const entry = entryMap.get(`skills/${hash}/${resource.path}`);
        if (entry?.sha256 !== resource.hash || entry.bytes !== resource.size)
          throw new StorageError(
            'ARCHIVE_INVALID',
            'Frozen Skill resource does not match its archive entry',
          );
      }
    db.transaction(() => recovery.rebuild()).immediate();
    const session = () => {
      const row = checked(
        dataRow,
        db.prepare('SELECT data FROM sessions WHERE id=?').get(manifest.sessionId),
      );
      return checked(SessionSummarySchema, JSON.parse(row.data));
    };
    const canonicalProviders = (providers: SessionArchiveManifest['dependencies']['providers']) =>
      providers
        .map((item) => ({ providerId: item.providerId, modelIds: [...item.modelIds].sort() }))
        .sort((a, b) => a.providerId.localeCompare(b.providerId));
    const derived = archiveDependencies(closure, manifest.dependencies.workspace);
    if (
      (session().activeRunId !== null) !== manifest.activeAtSnapshot ||
      closure.workspaceId !== (manifest.dependencies.workspace?.workspaceId ?? null) ||
      JSON.stringify(canonicalProviders(derived.providers)) !==
        JSON.stringify(canonicalProviders(manifest.dependencies.providers)) ||
      JSON.stringify([...derived.plugins].sort()) !==
        JSON.stringify([...manifest.dependencies.plugins].sort())
    )
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive dependency or activity summary does not match its journal facts',
      );
    if (session().snapshotSeq !== manifest.snapshotSeq || session().title !== manifest.title)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive summary does not match its authoritative journal',
      );
    const commit = new SessionEventCommit(
      orm,
      projector,
      (records) => pending.push(records),
      new WorkspaceRepository(orm),
    );
    const pending: StoredSessionEvent[] = [];
    const append = (inputs: readonly EventInput[]) => {
      if (inputs.length === 0) return;
      try {
        db.transaction(() => {
          commit.append(manifest.sessionId, inputs);
          journal.append(manifest.sessionId, pending);
        }).immediate();
      } finally {
        pending.length = 0;
      }
    };
    finished = true;
    return {
      directory,
      staged,
      manifest,
      closure,
      db,
      orm,
      files,
      journal,
      blobs,
      artifactBlobs,
      recovery,
      append,
      session,
      close: () => {
        artifactBlobs.close();
        files.close();
        db.close();
      },
    };
  } catch (cause) {
    if (cause instanceof StorageError && cause.code !== 'ARCHIVE_INVALID')
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive journal codec or historical relationships failed validation',
        { cause },
      );
    if (
      cause instanceof Error &&
      'code' in cause &&
      typeof cause.code === 'string' &&
      cause.code.startsWith('SQLITE_CONSTRAINT')
    )
      throw new StorageError('ARCHIVE_INVALID', 'Archive historical identities are inconsistent', {
        cause,
      });
    throw cause;
  } finally {
    rawFiles.close();
    if (!finished) {
      artifactBlobs.close();
      files.close();
      db.close();
    }
  }
}

/** Seal active histories without contacting providers, dispatching tools or updating independent memory. */
export function sealArchive(
  value: ArchiveValidation,
  operationId: string,
  archiveSha256: string,
  ownerUserId: string | null,
  at: number,
): void {
  const inputs = agentInterruptionEvents(value.orm, value.session(), at);
  for (const row of value.db
    .prepare('SELECT id FROM queued_inputs WHERE session_id=?')
    .all(value.manifest.sessionId))
    inputs.push({
      type: 'queue.deleted',
      runId: null,
      at,
      data: { inputId: checked(idRow, row).id },
    });
  value.append(inputs);
  for (const row of value.db
    .prepare(
      `SELECT id,json_extract(data,'$.runId') AS run_id FROM file_operations WHERE session_id=? AND json_extract(data,'$.status')='prepared'`,
    )
    .all(value.manifest.sessionId)) {
    const operation = checked(operationRow, row);
    value.append([
      {
        type: 'file.operation.observed',
        runId: operation.run_id,
        at,
        data: { operationId: operation.id, observation: { match: 'unavailable', at } },
      },
    ]);
  }
  for (const row of value.db
    .prepare(
      `SELECT data FROM file_change_batches WHERE session_id=? AND json_extract(data,'$.status') IN ('accepted','running')`,
    )
    .all(value.manifest.sessionId)) {
    const receipt = checked(FileChangeBatchReceiptSchema, JSON.parse(checked(dataRow, row).data));
    const updates: EventInput[] = receipt.items
      .filter((item) => item.status === 'running')
      .map((item) => ({
        type: 'file.batch.item',
        runId: null,
        at,
        data: {
          operationId: receipt.operationId,
          item: {
            ...item,
            status: 'unknown',
            error: 'Imported active publication has no confirmed result',
          },
        },
      }));
    updates.push({
      type: 'file.batch.finished',
      runId: null,
      at,
      data: {
        operationId: receipt.operationId,
        status: 'interrupted',
        error: 'Imported execution was sealed without replay',
      },
    });
    value.append(updates);
  }
  value.append([
    {
      type: 'session.imported',
      runId: null,
      at,
      data: { operationId, archiveSha256, importedThroughSeq: value.manifest.snapshotSeq },
      privateData: { importOwner: { userId: ownerUserId } },
    },
  ]);
}

export async function archiveJournalHash(
  value: ArchiveValidation,
  signal?: AbortSignal,
): Promise<{ path: string; bytes: number; sha256: string }> {
  const path = join(value.files.directory, `${value.manifest.sessionId}.jsonl`);
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const chunk of openOwnedFile(path)) {
    signal?.throwIfAborted();
    if (!(chunk instanceof Uint8Array))
      throw new StorageError('ARCHIVE_INVALID', 'Journal returned non-byte content');
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { path, bytes, sha256: hash.digest('hex') };
}
