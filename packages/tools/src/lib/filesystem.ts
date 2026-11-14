import { opendir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPatch } from 'diff';
import {
  checkCancelled,
  hashFileBytes,
  isPortableFileName,
  isSensitiveName,
  toWorkspaceRelativePath,
  workspacePath,
} from '@my-pi-harness/sandbox';
import { ToolError, type ToolResult } from './tool-registry';

interface ListedEntry {
  path: string;
  directory: boolean;
}

export const MAXIMUM_TEXT_BYTES = 500_000;
export const MAXIMUM_OUTPUT_CHARACTERS = 100_000;

export function decodeText(data: Uint8Array): string {
  if (data.includes(0)) throw new ToolError('BINARY_FILE', 'This file is not supported UTF-8 text');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
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
    content: [{ type: 'text', text: `SHA-256: ${hashFileBytes(Buffer.from(after))}\n${diff}` }],
    diff,
  };
}
