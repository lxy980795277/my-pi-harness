import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, opendir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPatch } from 'diff';
import {
  checkCancelled,
  isMissing,
  isPortableFileName,
  isSensitiveName,
  readStableFile,
  toWorkspaceRelativePath,
  workspacePath,
} from '@my-pi-harness/sandbox';
import { ToolError, type ToolResult } from './tool-registry';

import type { WorkspaceToolContext } from './tool-context';

interface ListedEntry {
  path: string;
  directory: boolean;
}

export const MAXIMUM_TEXT_BYTES = 500_000;
export const MAXIMUM_OUTPUT_CHARACTERS = 100_000;

export function hashBytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function decodeText(data: Uint8Array): string {
  if (data.includes(0)) throw new ToolError('BINARY_FILE', 'This file is not supported UTF-8 text');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (cause) {
    throw new ToolError('BINARY_FILE', 'This file is not supported UTF-8 text', { cause });
  }
}

/** Enumerate bounded regular entries without following links or exposing sensitive paths. */
export async function walkWorkspace(
  root: string,
  start: string,
  recursive: boolean,
  signal: AbortSignal,
  maximum: number,
): Promise<{ entries: ListedEntry[]; truncated: boolean }> {
  const pending = [{ path: start, depth: 0 }];
  const entries: ListedEntry[] = [];
  let visited = 0;
  while (pending.length > 0) {
    checkCancelled(signal);
    const current = pending.pop();
    if (!current) break;
    const actual = await workspacePath(root, toWorkspaceRelativePath(root, current.path));
    const directory = await opendir(actual);
    for await (const entry of directory) {
      checkCancelled(signal);
      visited += 1;
      if (visited > 5000 || entries.length >= maximum) return { entries, truncated: true };
      if (entry.isSymbolicLink() || isSensitiveName(entry.name) || !isPortableFileName(entry.name))
        continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const target = resolve(actual, entry.name);
      const item = { path: toWorkspaceRelativePath(root, target), directory: entry.isDirectory() };
      entries.push(item);
      if (recursive && item.directory && current.depth < 15 && entry.name !== 'node_modules')
        pending.push({ path: target, depth: current.depth + 1 });
    }
  }
  return { entries, truncated: false };
}

export async function readCurrentContent(
  path: string,
  signal: AbortSignal,
): Promise<Buffer | null> {
  try {
    return await readStableFile(path, signal, MAXIMUM_TEXT_BYTES);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Compare the caller's accepted preimage, including create-only null, with current bytes. */
export function assertPreimage(current: Buffer | null, expectedHash: string | null): void {
  const digest = current === null ? null : hashBytes(current);
  if (digest !== expectedHash)
    throw new ToolError(
      'PREIMAGE_MISMATCH',
      'The file changed or its expected hash does not match. Read it again before writing',
    );
}

/** Validate the resulting text and bounded diff before any write occurs. */
export function fileChangeResult(path: string, before: string, after: string): ToolResult {
  if (Buffer.byteLength(after) > MAXIMUM_TEXT_BYTES)
    throw new ToolError('FILE_TOO_LARGE', 'The resulting file exceeds 500000 bytes');
  const diff = createPatch(path, before, after, '', '', {
    context: 3,
    maxEditLength: 20_000,
    timeout: 1000,
  });
  if (diff === undefined || diff.length > MAXIMUM_OUTPUT_CHARACTERS)
    throw new ToolError('DIFF_LIMIT', 'The change is too large to produce a bounded diff');
  return {
    summary: `Wrote ${path}`,
    content: [{ type: 'text', text: `SHA-256: ${hashBytes(Buffer.from(after))}\n${diff}` }],
    diff,
  };
}

/** Recheck the parent and preimage before an atomic create-or-replace in the workspace. */
export async function writeTextFileAtomic(
  path: string,
  content: string,
  original: Buffer | null,
  context: WorkspaceToolContext,
): Promise<void> {
  checkCancelled(context.signal);
  const parent = dirname(path);
  const before = await lstat(parent);
  const existing = original === null ? undefined : await lstat(path);
  if (existing && existing.nlink !== 1)
    throw new ToolError('HARDLINK_FILE', 'Files with multiple hard links cannot be modified');
  const temporary = resolve(parent, `.my-pi-write-${randomUUID()}`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    existing ? existing.mode & 0o777 : 0o600,
  );
  try {
    await handle.writeFile(content, { encoding: 'utf8', signal: context.signal });
    await handle.sync();
    await handle.close();
    checkCancelled(context.signal);
    await workspacePath(
      context.workspaceRoot,
      toWorkspaceRelativePath(context.workspaceRoot, path),
      true,
    );
    const after = await lstat(parent);
    if (before.dev !== after.dev || before.ino !== after.ino)
      throw new ToolError('FILE_CHANGED', 'The parent directory changed before writing');
    assertPreimage(
      await readCurrentContent(path, context.signal),
      original === null ? null : hashBytes(original),
    );
    // link() creates only when absent; rename() could replace a concurrent creation.
    if (original === null) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}
