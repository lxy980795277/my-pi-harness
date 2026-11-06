import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Artifact } from '@my-pi-harness/protocol';
import type { PrivateSessionFiles } from '../sessions/private-files';
import { StorageError } from '../shared/errors';

export interface ArtifactLimits {
  maximumFileBytes: number;
  maximumProfileBytes: number;
}
export interface ArtifactDownload {
  readonly bytes: Buffer;
  release(): void;
}
export interface ArtifactBlob {
  readonly sha256: string;
  readonly bytes: number;
}

/** Immutable content-addressed files have independent publication and download references. */
export class ArtifactBlobs {
  private readonly downloads = new Map<string, number>();
  private readonly pending = new Map<string, number>();
  private closed = false;
  public constructor(
    private readonly files: PrivateSessionFiles,
    private readonly limits: ArtifactLimits = {
      maximumFileBytes: 33_554_432,
      maximumProfileBytes: 536_870_912,
    },
  ) {}

  public put(bytes: Uint8Array): ArtifactBlob {
    this.assertOpen();
    if (
      bytes.length === 0 ||
      bytes.length > this.limits.maximumFileBytes ||
      bytes.length > 33_554_432
    )
      throw new StorageError('INVALID_RECORD', 'Artifact exceeds the single-file byte limit');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const blob = { sha256, bytes: bytes.length };
    const target = this.path(sha256);
    this.files.checkDirectories();
    const names = this.files.names(this.files.artifactDirectory);
    if (names.includes(`${sha256}.blob`)) {
      this.read(blob);
      this.pending.set(sha256, (this.pending.get(sha256) ?? 0) + 1);
      return blob;
    }
    let total = 0;
    for (const name of names) {
      if (!/^(?:[a-f0-9]{64}\.blob|[a-f0-9-]{36}\.tmp)$/.test(name)) continue;
      const path = join(this.files.artifactDirectory, name);
      const status = lstatSync(path);
      if (!status.isFile() || status.isSymbolicLink())
        throw new StorageError('SESSION_LOG_INVALID', 'Artifact storage contains an invalid file');
      total += status.size;
    }
    if (total + bytes.length > this.limits.maximumProfileBytes)
      throw new StorageError('CONFLICT', 'Artifact profile byte quota is exhausted');
    const temporary = join(this.files.artifactDirectory, `${randomUUID()}.tmp`);
    const descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      this.files.checkFile(descriptor, temporary);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
        if (written === 0)
          throw new StorageError('SESSION_LOG_UNAVAILABLE', 'Artifact write made no progress');
        offset += written;
      }
      fchmodSync(descriptor, 0o400);
      fsyncSync(descriptor);
      this.files.checkFile(descriptor, temporary);
      linkSync(temporary, target);
    } finally {
      try {
        closeSync(descriptor);
      } finally {
        unlinkSync(temporary);
      }
    }
    this.files.syncDirectory(this.files.artifactDirectory);
    this.pending.set(sha256, (this.pending.get(sha256) ?? 0) + 1);
    return blob;
  }

  public read(blob: ArtifactBlob): Buffer {
    this.assertOpen();
    const path = this.path(blob.sha256);
    this.files.checkDirectories();
    let descriptor: number;
    try {
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (cause) {
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Artifact snapshot file is missing or inaccessible',
        { cause },
      );
    }
    try {
      const before = this.files.checkFile(descriptor, path);
      if (before.size !== blob.bytes || before.size > this.limits.maximumFileBytes)
        throw new StorageError('SESSION_LOG_INVALID', 'Artifact snapshot size is invalid');
      const buffer = Buffer.alloc(blob.bytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(descriptor, buffer, length, buffer.length - length, length);
        if (count === 0) break;
        length += count;
      }
      const bytes = buffer.subarray(0, length);
      const after = this.files.checkFile(descriptor, path);
      if (
        bytes.length !== blob.bytes ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        createHash('sha256').update(bytes).digest('hex') !== blob.sha256
      )
        throw new StorageError('SESSION_LOG_INVALID', 'Artifact snapshot checksum is invalid');
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  }

  public acquire(artifact: Artifact): ArtifactDownload {
    const bytes = this.read(artifact);
    const hash = artifact.sha256;
    this.downloads.set(hash, (this.downloads.get(hash) ?? 0) + 1);
    let released = false;
    return {
      bytes,
      release: () => {
        if (released) return;
        released = true;
        const count = (this.downloads.get(hash) ?? 0) - 1;
        if (count === 0) this.downloads.delete(hash);
        else this.downloads.set(hash, count);
      },
    };
  }

  /** A committed journal reference supersedes the temporary publication pin. */
  public committed(hashes: readonly string[]): void {
    for (const hash of hashes) this.abandon(hash);
  }

  /** Reclaim only unreferenced files without an in-flight publication or active download. */
  public collectUnreferenced(referenced: ReadonlySet<string>): number {
    this.assertOpen();
    let reclaimed = 0;
    for (const name of this.files.names(this.files.artifactDirectory)) {
      const temporary = /^[a-f0-9-]{36}\.tmp$/.test(name);
      if (!temporary && !/^[a-f0-9]{64}\.blob$/.test(name)) continue;
      const hash = name.slice(0, -5);
      if (
        !temporary &&
        (referenced.has(hash) || this.pending.has(hash) || this.downloads.has(hash))
      )
        continue;
      const path = join(this.files.artifactDirectory, name);
      const descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        reclaimed += this.files.checkFile(descriptor, path).size;
        unlinkSync(path);
      } finally {
        closeSync(descriptor);
      }
    }
    this.files.syncDirectory(this.files.artifactDirectory);
    return reclaimed;
  }

  /** Failed publications can release their pin only after dispatch has settled. */
  public abandon(hash: string): void {
    const count = (this.pending.get(hash) ?? 0) - 1;
    if (count <= 0) this.pending.delete(hash);
    else this.pending.set(hash, count);
  }

  public close(): void {
    this.closed = true;
    this.pending.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('STORAGE_CLOSED', 'Artifact storage is closed');
  }

  private path(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new StorageError('INVALID_RECORD', 'Artifact hash is invalid');
    return join(this.files.artifactDirectory, `${hash}.blob`);
  }
}
