import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  createReadStream,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { StorageError } from '../shared/errors';

export interface CopiedFile {
  bytes: number;
  sha256: string;
}
const maximumEntryBytes = 512 * 1024 * 1024;

export function archivePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 4096 ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new StorageError('ARCHIVE_INVALID', 'Archive contains an unsafe entry path');
}

export function ownedDirectory(path: string): void {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    throw new StorageError('ARCHIVE_INVALID', 'Archive storage directory is not private and owned');
}

export function managedFile(root: string, path: string): string {
  archivePath(path);
  const target = join(root, ...path.split('/'));
  let parent = root;
  for (const part of path.split('/').slice(0, -1)) {
    parent = join(parent, part);
    ownedDirectory(parent);
  }
  return target;
}

export function openOwnedFile(path: string): Readable {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive resource must be an owned regular single-link file',
      );
    return createReadStream(path, { fd, autoClose: true });
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export async function copyArchiveFile(
  input: Readable,
  path: string,
  expected?: CopiedFile,
  signal?: AbortSignal,
): Promise<CopiedFile> {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  let bytes = 0,
    complete = false;
  const hash = createHash('sha256');
  try {
    for await (const chunk of input) {
      signal?.throwIfAborted();
      if (!(chunk instanceof Uint8Array))
        throw new StorageError('ARCHIVE_INVALID', 'Archive stream returned non-byte content');
      bytes += chunk.byteLength;
      if (bytes > maximumEntryBytes || (expected !== undefined && bytes > expected.bytes))
        throw new StorageError('ARCHIVE_INVALID', 'Archive entry exceeds its declared byte limit');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = writeSync(fd, chunk, offset, chunk.byteLength - offset);
        if (written === 0)
          throw new StorageError('ARCHIVE_INVALID', 'Archive staging write made no progress');
        offset += written;
      }
    }
    const sha256 = hash.digest('hex');
    if (expected !== undefined && (expected.bytes !== bytes || expected.sha256 !== sha256))
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive entry length or checksum does not match its manifest',
      );
    fchmodSync(fd, 0o400);
    fsyncSync(fd);
    complete = true;
    return { bytes, sha256 };
  } finally {
    input.destroy();
    closeSync(fd);
    if (!complete) unlinkSync(path);
  }
}

export function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Checksummed import receipts and publication plans survive process loss independently of SQLite. */
export class ArchiveFiles {
  public readonly staging: string;
  public readonly resources: string;
  private readonly receipts: string;
  public constructor(public readonly root: string) {
    ownedDirectory(root);
    this.staging = join(root, 'staging');
    this.resources = join(root, 'resources');
    this.receipts = join(root, 'receipts');
    for (const path of [this.staging, this.resources, this.receipts]) ownedDirectory(path);
  }
  public stageNames(): string[] {
    return readdirSync(this.staging).filter((name) => /^stage-[a-f0-9-]{36}$/.test(name));
  }
  public createStage(): string {
    const path = join(this.staging, `stage-${randomUUID()}`);
    ownedDirectory(path);
    return path;
  }
  public removeStage(path: string): void {
    const suffix = relative(this.staging, resolve(path));
    if (suffix.includes(sep) || !/^stage-[a-f0-9-]{36}$/.test(suffix))
      throw new StorageError('ARCHIVE_INVALID', 'Archive staging path is not owned');
    rmSync(path, { recursive: true, force: true });
  }
  public receiptNames(): string[] {
    return readdirSync(this.receipts).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  }
  public receiptPath(id: string): string {
    return join(this.receipts, `${createHash('sha256').update(id).digest('hex')}.json`);
  }
  public writeReceipt(id: string, value: Record<string, unknown>): void {
    const body = JSON.stringify(value);
    const bytes = Buffer.from(
      JSON.stringify({ body: value, checksum: createHash('sha256').update(body).digest('hex') }) +
        '\n',
    );
    if (bytes.length > 16 * 1024 * 1024)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive publication plan exceeds its metadata limit',
      );
    const path = this.receiptPath(id);
    const temporary = join(this.receipts, `${randomUUID()}.tmp`);
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written === 0)
          throw new StorageError('ARCHIVE_INVALID', 'Import receipt write made no progress');
        offset += written;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    syncDirectory(this.receipts);
  }
  public readReceiptPath(path: string): unknown {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 16 * 1024 * 1024 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      )
        throw new StorageError('ARCHIVE_INVALID', 'Import receipt file is not private and owned');
      const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
      if (
        value === null ||
        typeof value !== 'object' ||
        !('body' in value) ||
        !('checksum' in value) ||
        createHash('sha256').update(JSON.stringify(value.body)).digest('hex') !== value.checksum
      )
        throw new StorageError('ARCHIVE_INVALID', 'Import receipt checksum is invalid');
      return value.body;
    } finally {
      closeSync(fd);
    }
  }
  public existingReceipt(id: string): unknown {
    const path = this.receiptPath(id);
    try {
      return this.readReceiptPath(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

/** Hash a managed file incrementally; publication never loads a complete journal into memory. */
export function hashArchiveFile(path: string): CopiedFile {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()))
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Archive publication source is not an owned regular file',
      );
    const chunk = Buffer.alloc(65536);
    const hash = createHash('sha256');
    let bytes = 0;
    for (;;) {
      const length = readSync(fd, chunk, 0, chunk.length, null);
      if (length === 0) break;
      bytes += length;
      hash.update(chunk.subarray(0, length));
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    closeSync(fd);
  }
}

/** Verify the same bounded file descriptor that supplies publication bytes. */
export function readArchiveBytes(path: string, expected: CopiedFile): Buffer {
  if (expected.bytes > 33554432)
    throw new StorageError('ARCHIVE_INVALID', 'Archive resource exceeds its supported byte limit');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()))
      throw new StorageError('ARCHIVE_INVALID', 'Archive resource is not an owned regular file');
    const buffer = Buffer.alloc(expected.bytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length);
    if (
      length !== expected.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== expected.sha256
    )
      throw new StorageError('ARCHIVE_INVALID', 'Archive resource changed before publication');
    return bytes;
  } finally {
    closeSync(fd);
  }
}
