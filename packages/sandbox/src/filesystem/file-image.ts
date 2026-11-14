import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, realpath, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SandboxError, checkCancelled, isMissing } from '../errors';
import {
  canonicalWorkspace,
  openRegular,
  toWorkspaceRelativePath,
  workspacePath,
  type WorkspaceContext,
} from './workspace-path';

/** Decimal filesystem ids retain exact values across JSON and platform number widths. */
export interface FilesystemIdentity {
  device: string;
  inode: string;
}

/** Existence and supported permission bits travel with the exact original bytes. */
export type FileImage = { bytes: Uint8Array; mode: number } | { bytes: null; mode: null };

export interface StableFileImage {
  bytes: Buffer;
  mode: number;
  identity: FilesystemIdentity;
}

/** A checked workspace target; authorization still belongs to the host that supplies the context. */
export interface WorkspaceFileSnapshot {
  rootPath: string;
  relativePath: string;
  path: string;
  rootIdentity: FilesystemIdentity;
  parentIdentity: FilesystemIdentity;
  fileIdentity: FilesystemIdentity | null;
  image: FileImage;
}

function identity(stat: BigIntStats): FilesystemIdentity {
  return { device: stat.dev.toString(), inode: stat.ino.toString() };
}

export function sameFilesystemIdentity(
  left: FilesystemIdentity | null,
  right: FilesystemIdentity | null,
): boolean {
  return left?.device === right?.device && left?.inode === right?.inode;
}

/** The model's expectedHash and the host's durable image references use the same byte digest. */
export function hashFileBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function directoryIdentity(path: string): Promise<FilesystemIdentity> {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new SandboxError('FILE_CHANGED', 'The workspace directory identity changed');
  return identity(stat);
}

/**
 * Read bounded bytes from an already resolved file and reject observed changes.
 * @param path Path resolved by the caller's workspace and protected-path policy.
 * @param signal Cancellation of the owning operation.
 * @param maximum Maximum bytes accepted, including growth after opening.
 * @returns Stable observed bytes; the file handle is closed on every outcome.
 */
export async function readStableFile(
  path: string,
  signal: AbortSignal,
  maximum: number,
): Promise<Buffer> {
  return (await readStableFileImage(path, signal, maximum)).bytes;
}

/** Read bytes, mode and identity from the same descriptor and reject observed replacement or change. */
export async function readStableFileImage(
  path: string,
  signal: AbortSignal,
  maximum: number,
): Promise<StableFileImage> {
  checkCancelled(signal);
  const handle = await openRegular(path, maximum);
  try {
    return await readOpenedFileImage(path, handle, signal, maximum);
  } finally {
    await handle.close();
  }
}

/** Read an owned regular descriptor; its caller retains closing responsibility. */
export async function readOpenedFileImage(
  path: string,
  handle: FileHandle,
  signal: AbortSignal,
  maximum: number,
): Promise<StableFileImage> {
  checkCancelled(signal);
  const canonical = await realpath(path);
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.nlink !== 1n)
    throw new SandboxError('FILE_CHANGED', 'The source file identity changed');
  const buffer = Buffer.alloc(maximum + 1);
  let length = 0;
  while (length < buffer.length) {
    checkCancelled(signal);
    const chunk = await handle.read(buffer, length, buffer.length - length, length);
    if (chunk.bytesRead === 0) break;
    length += chunk.bytesRead;
  }
  const after = await handle.stat({ bigint: true });
  if (length > maximum) throw new SandboxError('FILE_TOO_LARGE', 'File grew beyond its size limit');
  if (
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    before.mode !== after.mode ||
    after.nlink !== 1n ||
    BigInt(length) !== after.size
  )
    throw new SandboxError('FILE_CHANGED', 'File changed while reading');
  try {
    const observed = await lstat(path, { bigint: true });
    if (
      !observed.isFile() ||
      observed.dev !== before.dev ||
      observed.ino !== before.ino ||
      observed.nlink !== 1n ||
      observed.size !== after.size ||
      observed.mtimeNs !== after.mtimeNs ||
      observed.ctimeNs !== after.ctimeNs ||
      observed.mode !== after.mode ||
      (await realpath(path)) !== canonical
    )
      throw new SandboxError('FILE_CHANGED', 'The source path changed while reading');
  } catch (cause) {
    if (cause instanceof SandboxError) throw cause;
    throw new SandboxError('FILE_CHANGED', 'The source path changed while reading', { cause });
  }
  checkCancelled(signal);
  return {
    bytes: buffer.subarray(0, length),
    mode: Number(before.mode & 0o777n),
    identity: identity(before),
  };
}

/** Resolve and observe the complete target while checking its root and parent identities. */
export async function readWorkspaceFileSnapshot(
  context: WorkspaceContext,
  relativePath: string,
  maximumBytes: number,
): Promise<WorkspaceFileSnapshot> {
  const rootPath = await canonicalWorkspace(context);
  const path = await workspacePath(rootPath, relativePath, true);
  const parent = dirname(path);
  const rootIdentity = await directoryIdentity(rootPath);
  const parentIdentity = await directoryIdentity(parent);
  let file: StableFileImage | undefined;
  try {
    file = await readStableFileImage(path, context.signal, maximumBytes);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  checkCancelled(context.signal);
  await workspacePath(rootPath, relativePath, true);
  if (
    !sameFilesystemIdentity(rootIdentity, await directoryIdentity(rootPath)) ||
    !sameFilesystemIdentity(parentIdentity, await directoryIdentity(parent))
  )
    throw new SandboxError('FILE_CHANGED', 'The workspace directory changed while reading');
  return {
    rootPath,
    path,
    relativePath: toWorkspaceRelativePath(rootPath, path),
    rootIdentity,
    parentIdentity,
    fileIdentity: file?.identity ?? null,
    image: file ? { bytes: file.bytes, mode: file.mode } : { bytes: null, mode: null },
  };
}
