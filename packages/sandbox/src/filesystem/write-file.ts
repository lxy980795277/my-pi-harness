import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SandboxError, checkCancelled, isMissing } from '../errors';
import type { WorkspaceContext } from './workspace-path';
import {
  readOpenedFileImage,
  readWorkspaceFileSnapshot,
  sameFilesystemIdentity,
  type FileImage,
  type FilesystemIdentity,
  type WorkspaceFileSnapshot,
} from './file-image';

export type FilePublicationState = 'not-published' | 'unknown';

/** An attempted target syscall may have taken effect; callers must not infer a safe retry. */
export class FilePublicationError extends SandboxError {
  public constructor(
    public readonly publication: FilePublicationState,
    cause: unknown,
  ) {
    super(
      cause instanceof SandboxError ? cause.code : 'FILE_WRITE_FAILED',
      cause instanceof SandboxError
        ? cause.message
        : 'The workspace file operation could not be completed',
      { cause },
    );
    this.name = 'FilePublicationError';
  }
}

/** Compare raw content and supported permission bits, including an absent target. */
export function sameFileImage(left: FileImage, right: FileImage): boolean {
  if (left.bytes === null || right.bytes === null) return left.bytes === right.bytes;
  return left.mode === right.mode && Buffer.from(left.bytes).equals(right.bytes);
}

function assertSnapshot(before: WorkspaceFileSnapshot, current: WorkspaceFileSnapshot): void {
  if (
    before.rootPath !== current.rootPath ||
    before.path !== current.path ||
    !sameFilesystemIdentity(before.rootIdentity, current.rootIdentity) ||
    !sameFilesystemIdentity(before.parentIdentity, current.parentIdentity)
  )
    throw new SandboxError('FILE_CHANGED', 'The workspace directory changed before publication');
  if (
    !sameFilesystemIdentity(before.fileIdentity, current.fileIdentity) ||
    !sameFileImage(before.image, current.image)
  )
    throw new SandboxError('PREIMAGE_MISMATCH', 'The workspace file changed before publication');
}

async function recheckSnapshot(
  context: WorkspaceContext,
  before: WorkspaceFileSnapshot,
  maximum: number,
): Promise<WorkspaceFileSnapshot> {
  let current: WorkspaceFileSnapshot;
  try {
    current = await readWorkspaceFileSnapshot(context, before.relativePath, maximum);
  } catch (cause) {
    if (cause instanceof SandboxError && cause.code === 'FILE_TOO_LARGE')
      throw new SandboxError('PREIMAGE_MISMATCH', 'The workspace file grew before publication', {
        cause,
      });
    throw cause;
  }
  assertSnapshot(before, current);
  return current;
}

async function cleanupTemporary(path: string, expected: FilesystemIdentity): Promise<void> {
  try {
    const entry = await lstat(path, { bigint: true });
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.dev.toString() !== expected.device ||
      entry.ino.toString() !== expected.inode
    )
      throw new SandboxError('FILE_CHANGED', 'The temporary file identity changed');
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/**
 * Publish one checked byte image through the owning host's durable barrier.
 * Target checks and cancellation precede beforePublish. Once a target syscall is attempted,
 * cancellation does not interrupt settlement; every later error has publication=unknown.
 * POSIX directory metadata is synced. Windows uses the file flush and native rename semantics.
 */
export async function publishWorkspaceFile(
  context: WorkspaceContext,
  before: WorkspaceFileSnapshot,
  after: FileImage,
  beforePublish: () => void,
): Promise<void> {
  let attempted = false;
  let temporary: string | undefined;
  let temporaryIdentity: FilesystemIdentity | undefined;
  let handle: FileHandle | undefined;
  let directoryHandle: FileHandle | undefined;
  let failure: unknown;
  let failed = false;
  const desired: FileImage =
    after.bytes === null
      ? { bytes: null, mode: null }
      : { bytes: Buffer.from(after.bytes), mode: after.mode };
  const maximum = Math.max(before.image.bytes?.byteLength ?? 0, desired.bytes?.byteLength ?? 0);
  try {
    const current = await recheckSnapshot(context, before, maximum);
    if (sameFileImage(before.image, desired)) return;
    const parent = dirname(current.path);
    if (process.platform !== 'win32') {
      directoryHandle = await open(
        parent,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const directory = await directoryHandle.stat({ bigint: true });
      if (
        !sameFilesystemIdentity(current.parentIdentity, {
          device: directory.dev.toString(),
          inode: directory.ino.toString(),
        })
      )
        throw new SandboxError('FILE_CHANGED', 'The workspace parent directory changed');
    }
    if (desired.bytes !== null) {
      temporary = resolve(parent, `.my-pi-write-${randomUUID()}`);
      handle = await open(
        temporary,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      const created = await handle.stat({ bigint: true });
      temporaryIdentity = { device: created.dev.toString(), inode: created.ino.toString() };
      await handle.writeFile(desired.bytes, { signal: context.signal });
      // Creation's mode is filtered by umask; explicit chmod preserves the supported original bits.
      await handle.chmod(desired.mode);
      await handle.sync();
      const staged = await readOpenedFileImage(temporary, handle, context.signal, maximum);
      if (
        !sameFilesystemIdentity(temporaryIdentity, staged.identity) ||
        !sameFileImage(staged, desired)
      )
        throw new SandboxError('FILE_CHANGED', 'The temporary file changed before publication');
    }
    await recheckSnapshot(context, before, maximum);
    checkCancelled(context.signal);
    beforePublish();
    checkCancelled(context.signal);
    await recheckSnapshot(context, before, maximum);
    if (temporary !== undefined && handle !== undefined && desired.bytes !== null) {
      const staged = await readOpenedFileImage(temporary, handle, context.signal, maximum);
      if (
        !sameFilesystemIdentity(temporaryIdentity ?? null, staged.identity) ||
        !sameFileImage(staged, desired)
      )
        throw new SandboxError('FILE_CHANGED', 'The temporary file changed before publication');
      await handle.close();
      handle = undefined;
    }
    checkCancelled(context.signal);
    attempted = true;
    if (desired.bytes === null) await unlink(current.path);
    else if (temporary !== undefined) {
      if (before.image.bytes === null) await link(temporary, current.path);
      else await rename(temporary, current.path);
    }
    await directoryHandle?.sync();
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      failure ??= error;
      failed = true;
    }
    try {
      if (temporary !== undefined && temporaryIdentity !== undefined)
        await cleanupTemporary(temporary, temporaryIdentity);
    } catch (error) {
      failure ??= error;
      failed = true;
    }
    try {
      await directoryHandle?.close();
    } catch (error) {
      failure ??= error;
      failed = true;
    }
  }
  if (failed) throw new FilePublicationError(attempted ? 'unknown' : 'not-published', failure);
}
