import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
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
export interface ArtifactBlobWriteOptions {
  allowEmpty?: boolean;
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

  public put(bytes: Uint8Array, options: ArtifactBlobWriteOptions = {}): ArtifactBlob {
    this.assertOpen();
    if (
      (bytes.length === 0 && options.allowEmpty !== true) ||
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

  /** Remove abandoned publisher temporaries under exclusive startup ownership, retaining linked final blobs. */
  public recoverTemporaryFiles(): void {
    this.assertOpen();
    this.files.checkDirectories();
    for (const name of this.files.names(this.files.artifactDirectory)) {
      if (!/^[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      const path = join(this.files.artifactDirectory, name);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const status = fstatSync(fd);
        if (
          !status.isFile() ||
          (status.nlink !== 1 && status.nlink !== 2) ||
          (process.getuid && status.uid !== process.getuid()) ||
          (process.platform !== 'win32' && (status.mode & 0o077) !== 0)
        )
          throw new StorageError(
            'SESSION_LOG_INVALID',
            'Artifact temporary is not an owned private publisher file',
          );
        if (status.nlink === 2) {
          const hash = createHash('sha256');
          const chunk = Buffer.alloc(65536);
          let total = 0;
          for (;;) {
            const length = readSync(fd, chunk, 0, chunk.length, null);
            if (length === 0) break;
            total += length;
            if (total > 33554432)
              throw new StorageError(
                'SESSION_LOG_INVALID',
                'Artifact temporary exceeds the publisher byte limit',
              );
            hash.update(chunk.subarray(0, length));
          }
          const target = this.path(hash.digest('hex'));
          const finalFd = openSync(
            target,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            const final = fstatSync(finalFd);
            if (
              !final.isFile() ||
              final.dev !== status.dev ||
              final.ino !== status.ino ||
              final.nlink !== 2
            )
              throw new StorageError(
                'SESSION_LOG_INVALID',
                'Artifact temporary hardlink does not identify its immutable final blob',
              );
          } finally {
            closeSync(finalFd);
          }
        }
        unlinkSync(path);
      } finally {
        closeSync(fd);
      }
    }
    this.files.syncDirectory(this.files.artifactDirectory);
  }

  /** Reject an import before publication when its missing immutable blobs exceed the real pool quota. */
  public assertPublicationCapacity(references: readonly ArtifactBlob[]): void {
    this.assertOpen();
    this.files.checkDirectories();
    const names = this.files.names(this.files.artifactDirectory);
    const available = new Set(names);
    let total = 0;
    for (const name of names) {
      if (!/^(?:[a-f0-9]{64}\.blob|[a-f0-9-]{36}\.tmp)$/.test(name)) continue;
      const path = join(this.files.artifactDirectory, name);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        total += this.files.checkFile(fd, path).size;
      } finally {
        closeSync(fd);
      }
    }
    const unique = new Map(references.map((reference) => [reference.sha256, reference]));
    for (const reference of unique.values()) {
      this.path(reference.sha256);
      if (reference.bytes > this.limits.maximumFileBytes || reference.bytes > 33_554_432)
        throw new StorageError(
          'CONFLICT',
          'Imported artifact exceeds the target single-file byte quota',
        );
      if (available.has(`${reference.sha256}.blob`)) this.read(reference);
      else total += reference.bytes;
    }
    if (total > this.limits.maximumProfileBytes)
      throw new StorageError(
        'CONFLICT',
        'Imported resources exceed the target artifact pool byte quota',
      );
  }

  /** Hold immutable bytes while an archive streams them without retaining their body in memory. */
  public retain(sha256: string): () => void {
    this.assertOpen();
    this.path(sha256);
    this.downloads.set(sha256, (this.downloads.get(sha256) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.downloads.get(sha256) ?? 1) - 1;
      if (count === 0) this.downloads.delete(sha256);
      else this.downloads.set(sha256, count);
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
