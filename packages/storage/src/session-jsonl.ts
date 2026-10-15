import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { HarnessEvent } from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { sessionLogDirectory } from './session-log-directory.js';

interface MirrorCursor {
  seq: number;
  size: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
}
type EventsAfter = (afterSeq: number) => Iterable<HarnessEvent>;
const MAXIMUM_LINE_BYTES = 32 * 1024 * 1024;

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function requireOwner(entry: Stats): void {
  if (process.getuid && entry.uid !== process.getuid())
    throw new StorageError('SESSION_LOG_INVALID', 'Session logs must belong to the current user');
}
function decodedLine(bytes: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

interface OwnedDirectory {
  path: string;
  identity: Stats;
  fd: number | undefined;
}

/** Synchronous public-event mirror; SQLite remains authoritative and owns transaction outcomes. */
export class SessionJsonlMirror {
  private readonly directory: string;
  private readonly directories: OwnedDirectory[] = [];
  private readonly cursors = new Map<string, MirrorCursor>();
  private closed = false;

  public constructor(
    profileDirectory: string,
    sessionLogRoot = join(profileDirectory, '.my-pi-harness'),
  ) {
    sessionLogDirectory(profileDirectory, sessionLogRoot);
    const requestedRoot = resolve(sessionLogRoot);
    const parent = dirname(requestedRoot);
    if (lstatSync(parent).isSymbolicLink())
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Session log parent must not be a symbolic link',
      );
    const canonicalParent = realpathSync(parent);
    const root = join(canonicalParent, basename(requestedRoot));
    this.directory = sessionLogDirectory(profileDirectory, root);
    try {
      this.holdDirectory(profileDirectory);
      this.holdDirectory(canonicalParent);
      for (const path of [root, join(root, 'sessions'), this.directory]) {
        this.checkDirectories();
        try {
          mkdirSync(path, { mode: 0o700 });
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        }
        this.holdDirectory(path, true);
      }
      for (const directory of this.directories)
        if (directory.fd !== undefined) fsyncSync(directory.fd);
    } catch (error) {
      try {
        this.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Session log setup and cleanup failed');
      }
      throw error;
    }
  }

  public validateSessionId(id: string): void {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id))
      throw new StorageError(
        'INVALID_RECORD',
        'Session ID cannot be used as a private log filename',
      );
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const directory of [...this.directories].reverse()) {
      if (directory.fd === undefined) continue;
      try {
        closeSync(directory.fd);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Session log directory cleanup failed');
  }

  private holdDirectory(path: string, privateDirectory = false): void {
    if (this.directories.some((entry) => entry.path === path)) return;
    const identity = lstatSync(path);
    if (!identity.isDirectory() || identity.isSymbolicLink() || realpathSync(path) !== path)
      throw new StorageError('SESSION_LOG_INVALID', 'Session log paths must be real directories');
    requireOwner(identity);
    const fd =
      process.platform === 'win32'
        ? undefined
        : openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    this.directories.push({ path, identity, fd });
    this.checkDirectories();
    if (privateDirectory && fd !== undefined) fchmodSync(fd, 0o700);
  }

  private checkDirectories(): void {
    for (const directory of this.directories) {
      const current = lstatSync(directory.path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameFile(current, directory.identity) ||
        (directory.fd !== undefined && !sameFile(current, fstatSync(directory.fd))) ||
        realpathSync(directory.path) !== directory.path
      )
        throw new StorageError('SESSION_LOG_INVALID', 'Session log directory identity changed');
      requireOwner(current);
    }
  }

  private checkFile(fd: number, path: string): Stats {
    this.checkDirectories();
    const opened = fstatSync(fd);
    const current = lstatSync(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      current.isSymbolicLink() ||
      !sameFile(opened, current)
    )
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Session logs must be regular files without links',
      );
    requireOwner(opened);
    return opened;
  }

  private open(path: string): { fd: number; created: boolean } {
    this.checkDirectories();
    const flags =
      constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    try {
      return { fd: openSync(path, flags), created: false };
    } catch (error) {
      if (!missing(error)) throw error;
      return {
        fd: openSync(path, flags | constants.O_CREAT | constants.O_EXCL, 0o600),
        created: true,
      };
    }
  }

  private append(fd: number, path: string, value: string): void {
    this.checkFile(fd, path);
    const bytes = Buffer.from(value);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written === 0)
        throw new StorageError('SESSION_LOG_UNAVAILABLE', 'Session log write made no progress');
      offset += written;
    }
  }

  private reconcile(
    fd: number,
    path: string,
    events: Iterator<HarnessEvent>,
  ): { seq: number; changed: boolean } {
    let seq = 0;
    let position = 0;
    let validBytes = 0;
    let size = 0;
    let parts: Buffer[] = [];
    let changed = false;
    const consume = (line: Buffer): void => {
      const value: unknown = decodedLine(line);
      const expected = events.next();
      if (
        expected.done ||
        expected.value.seq !== seq + 1 ||
        !isDeepStrictEqual(value, expected.value)
      )
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'A complete session log record disagrees with SQLite',
        );
      seq += 1;
    };
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const length = readSync(fd, buffer, 0, buffer.length, position);
      if (length === 0) break;
      let start = 0;
      for (let index = 0; index < length; index += 1) {
        if (buffer[index] !== 10) continue;
        const segment = Buffer.from(buffer.subarray(start, index));
        size += segment.length;
        if (size > MAXIMUM_LINE_BYTES)
          throw new StorageError('SESSION_LOG_INVALID', 'Session log line is too large');
        parts.push(segment);
        consume(Buffer.concat(parts, size));
        parts = [];
        size = 0;
        validBytes = position + index + 1;
        start = index + 1;
      }
      const tail = Buffer.from(buffer.subarray(start, length));
      size += tail.length;
      if (size > MAXIMUM_LINE_BYTES)
        throw new StorageError('SESSION_LOG_INVALID', 'Session log line is too large');
      if (tail.length > 0) parts.push(tail);
      position += length;
    }
    if (size > 0) {
      const tail = Buffer.concat(parts, size);
      let complete = true;
      try {
        decodedLine(tail);
      } catch {
        complete = false; /* A crash may leave only the final JSON fragment incomplete. */
      }
      if (complete) {
        consume(tail);
        this.append(fd, path, '\n');
      } else {
        this.checkFile(fd, path);
        ftruncateSync(fd, validBytes);
      }
      changed = true;
    }
    return { seq, changed };
  }

  /** Reconcile changed files, then append each newly committed event once and fsync one batch. */
  public sync(sessionId: string, source: EventsAfter): void {
    try {
      this.syncFile(sessionId, source);
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Session JSONL could not be reconciled safely',
        { cause },
      );
    }
  }

  private syncFile(sessionId: string, source: EventsAfter): void {
    this.validateSessionId(sessionId);
    const path = join(this.directory, `${sessionId}.jsonl`);
    const { fd, created } = this.open(path);
    try {
      const before = this.checkFile(fd, path);
      fchmodSync(fd, 0o600);
      const cached = this.cursors.get(sessionId);
      const trusted =
        cached &&
        cached.dev === before.dev &&
        cached.ino === before.ino &&
        cached.size === before.size &&
        cached.mtimeMs === before.mtimeMs &&
        cached.ctimeMs === before.ctimeMs;
      let seq = trusted ? cached.seq : 0;
      let changed = created || (before.mode & 0o777) !== 0o600;
      const iterator = source(seq)[Symbol.iterator]();
      if (!trusted) {
        const result = this.reconcile(fd, path, iterator);
        seq = result.seq;
        changed ||= result.changed;
      }
      for (let next = iterator.next(); !next.done; next = iterator.next()) {
        const event = next.value;
        if (event.seq !== seq + 1 || event.sessionId !== sessionId)
          throw new StorageError(
            'SESSION_LOG_INVALID',
            'SQLite session log sequence is inconsistent',
          );
        this.append(fd, path, `${JSON.stringify(event)}\n`);
        seq = event.seq;
        changed = true;
      }
      this.checkFile(fd, path);
      if (changed) fsyncSync(fd);
      if (created) {
        const directory = this.directories.find((entry) => entry.path === this.directory);
        if (directory?.fd !== undefined) fsyncSync(directory.fd);
      }
      const after = this.checkFile(fd, path);
      this.cursors.set(sessionId, {
        seq,
        size: after.size,
        dev: after.dev,
        ino: after.ino,
        mtimeMs: after.mtimeMs,
        ctimeMs: after.ctimeMs,
      });
    } finally {
      closeSync(fd);
    }
  }
}
