import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  createReadStream,
  fchmodSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Type, type Static } from 'typebox';
import { HarnessEventSchema } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import type { PrivateSessionFiles } from './private-files.js';
import { checked } from '../shared/validation.js';

/** One command's complete public envelopes and private replay material. */
export type StoredSessionEvent = Static<typeof StoredEventSchema>;

/** An indivisible journal line; a torn tail never replays a partial command. */
export type SessionBatch = Static<typeof SessionBatchSchema>;

/** A bounded byte snapshot of complete durable batches; the consumer owns stream disposal. */
export interface SessionLogDownload {
  content: Readable;
  byteLength: number;
}

interface Cursor {
  seq: number;
  batchId: string | null;
  signature: string;
  byteLength: number;
}

const StoredEventSchema = Type.Object(
  {
    event: HarnessEventSchema,
    privateData: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

/** Exact disk batch format; public event readers never expose its private records. */
export const SessionBatchSchema = Type.Object(
  {
    version: Type.Literal(2),
    batchId: Type.String({ minLength: 1 }),
    previousBatchId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    sessionId: Type.String({ minLength: 1 }),
    firstSeq: Type.Integer({ minimum: 1 }),
    records: Type.Array(StoredEventSchema, { minItems: 1, maxItems: 10000 }),
    checksum: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);

const MAXIMUM_LINE_BYTES = 32 * 1024 * 1024;

function signature(value: Stats): string {
  return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(':');
}

function checksum(batch: Omit<SessionBatch, 'checksum'>): string {
  return createHash('sha256').update(JSON.stringify(batch)).digest('hex');
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Authoritative host journal; appends are durable before the SQLite projection commits. */
export class SessionJournal {
  private readonly cursors = new Map<string, Cursor>();
  public constructor(private readonly files: PrivateSessionFiles) {}

  public sessionIds(): string[] {
    return this.files
      .names(this.files.directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => {
        const id = name.slice(0, -6);
        this.files.validateId(id);
        return id;
      });
  }

  private open(sessionId: string, create: boolean): { fd: number; path: string; created: boolean } {
    this.files.validateId(sessionId);
    this.files.checkDirectories();
    const path = join(this.files.directory, `${sessionId}.jsonl`);
    const flags =
      constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    try {
      return { fd: openSync(path, flags), path, created: false };
    } catch (error) {
      if (!create || !missing(error)) throw error;
      return {
        fd: openSync(path, flags | constants.O_CREAT | constants.O_EXCL, 0o600),
        path,
        created: true,
      };
    }
  }

  private write(fd: number, path: string, bytes: Buffer): void {
    this.files.checkFile(fd, path);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written === 0)
        throw new StorageError('SESSION_LOG_UNAVAILABLE', 'Session log write made no progress');
      offset += written;
    }
  }

  /** Validate checksums and sequence while streaming; only a final incomplete JSON fragment is removed. */
  public *read(sessionId: string): Generator<SessionBatch> {
    const { fd, path } = this.open(sessionId, false);
    let seq = 0;
    let previousBatchId: string | null = null;
    let validBytes = 0;
    let position = 0;
    let lineLength = 0;
    let parts: Buffer[] = [];
    let changed = false;
    const decode = (bytes: Buffer): SessionBatch => {
      const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const value = checked(SessionBatchSchema, decoded);
      const { checksum: digest, ...body } = value;
      if (
        value.sessionId !== sessionId ||
        value.firstSeq !== seq + 1 ||
        value.previousBatchId !== previousBatchId ||
        checksum(body) !== digest
      )
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'Session batch identity, checksum or sequence is invalid',
        );
      for (const record of value.records) {
        if (record.event.sessionId !== sessionId || record.event.seq !== seq + 1)
          throw new StorageError('SESSION_LOG_INVALID', 'Session event sequence is invalid');
        seq += 1;
      }
      previousBatchId = value.batchId;
      return value;
    };
    try {
      this.files.checkFile(fd, path);
      fchmodSync(fd, 0o600);
      const buffer = Buffer.alloc(64 * 1024);
      while (true) {
        const length = readSync(fd, buffer, 0, buffer.length, position);
        if (length === 0) break;
        let start = 0;
        for (let index = 0; index < length; index += 1) {
          if (buffer[index] !== 10) continue;
          const segment = Buffer.from(buffer.subarray(start, index));
          lineLength += segment.length;
          if (lineLength > MAXIMUM_LINE_BYTES)
            throw new StorageError('SESSION_LOG_INVALID', 'Session batch is too large');
          parts.push(segment);
          yield decode(Buffer.concat(parts, lineLength));
          parts = [];
          lineLength = 0;
          validBytes = position + index + 1;
          start = index + 1;
        }
        const tail = Buffer.from(buffer.subarray(start, length));
        lineLength += tail.length;
        if (lineLength > MAXIMUM_LINE_BYTES)
          throw new StorageError('SESSION_LOG_INVALID', 'Session batch is too large');
        if (tail.length > 0) parts.push(tail);
        position += length;
      }
      if (lineLength > 0) {
        const bytes = Buffer.concat(parts, lineLength);
        let complete = true;
        try {
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          complete = false; /* A crash may leave only the last command's JSON incomplete. */
        }
        if (complete) {
          yield decode(bytes);
          this.write(fd, path, Buffer.from('\n'));
        } else {
          this.files.checkFile(fd, path);
          ftruncateSync(fd, validBytes);
        }
        changed = true;
      }
      if (changed) fsyncSync(fd);
      const current = this.files.checkFile(fd, path);
      this.cursors.set(sessionId, {
        seq,
        batchId: previousBatchId,
        signature: signature(current),
        byteLength: current.size,
      });
    } catch (cause) {
      if (cause instanceof StorageError && cause.code === 'SESSION_LOG_INVALID') throw cause;
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Session journal could not be replayed safely',
        { cause },
      );
    } finally {
      closeSync(fd);
    }
  }

  /** Open the current durable prefix without replay, repair, reserialization or later appends. */
  public openDownload(sessionId: string): SessionLogDownload {
    this.files.validateId(sessionId);
    this.files.checkDirectories();
    const cursor = this.cursors.get(sessionId);
    if (cursor === undefined)
      throw new StorageError('SESSION_LOG_INVALID', 'Session journal has no committed cursor');
    const path = join(this.files.directory, `${sessionId}.jsonl`);
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (signature(this.files.checkFile(fd, path)) !== cursor.signature)
        throw new StorageError('SESSION_LOG_INVALID', 'Session journal changed outside its owner');
      const content = createReadStream(path, {
        fd,
        autoClose: true,
        start: 0,
        end: cursor.byteLength - 1,
      });
      return { content, byteLength: cursor.byteLength };
    } catch (cause) {
      if (fd !== undefined) closeSync(fd);
      if (cause instanceof StorageError) throw cause;
      throw new StorageError('SESSION_LOG_INVALID', 'Session journal cannot be downloaded safely', {
        cause,
      });
    }
  }

  /** Commit one fully validated command; callers freeze writes after every uncertain failure. */
  public append(sessionId: string, records: readonly StoredSessionEvent[]): void {
    if (records.length === 0) return;
    const cursor = this.cursors.get(sessionId);
    const body: Omit<SessionBatch, 'checksum'> = {
      version: 2,
      batchId: randomUUID(),
      previousBatchId: cursor?.batchId ?? null,
      sessionId,
      firstSeq: (cursor?.seq ?? 0) + 1,
      records: [...records],
    };
    const batch = checked(SessionBatchSchema, { ...body, checksum: checksum(body) });
    for (const [index, record] of records.entries())
      if (record.event.sessionId !== sessionId || record.event.seq !== batch.firstSeq + index)
        throw new StorageError('INVALID_RECORD', 'Session command sequence is invalid');
    const bytes = Buffer.from(`${JSON.stringify(batch)}\n`);
    if (bytes.length > MAXIMUM_LINE_BYTES)
      throw new StorageError('INVALID_RECORD', 'Session command exceeds the journal batch limit');
    const { fd, path, created } = this.open(sessionId, true);
    try {
      const before = this.files.checkFile(fd, path);
      if (
        (cursor && (created || cursor.signature !== signature(before))) ||
        (!cursor && before.size !== 0)
      )
        throw new StorageError('SESSION_LOG_INVALID', 'Session journal changed outside its owner');
      fchmodSync(fd, 0o600);
      this.write(fd, path, bytes);
      fsyncSync(fd);
      if (created) this.files.syncDirectory(this.files.directory);
      const current = this.files.checkFile(fd, path);
      this.cursors.set(sessionId, {
        seq: batch.firstSeq + batch.records.length - 1,
        batchId: batch.batchId,
        signature: signature(current),
        byteLength: current.size,
      });
    } finally {
      closeSync(fd);
    }
  }
}
