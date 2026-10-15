import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPatch } from 'diff';
import { stringArgument } from './catalog.js';
import { ExecutionError, checkCancelled, isMissing } from './errors.js';
import { extractPdf } from './pdf.js';
import type { ExecutionContext, ExecutionResult } from './types.js';
import {
  isPortableFileName,
  isSensitiveName,
  openRegular,
  toWorkspaceRelativePath,
  workspacePath,
} from './workspace-path.js';

const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_TEXT_BYTES = 500_000;
const MAXIMUM_OUTPUT_CHARACTERS = 100_000;

export function hashBytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function textResult(summary: string, text: string, diff?: string): ExecutionResult {
  return { summary, content: [{ type: 'text', text }], ...(diff === undefined ? {} : { diff }) };
}

function decodeText(data: Uint8Array): string {
  if (data.includes(0))
    throw new ExecutionError('BINARY_FILE', 'This file is not supported UTF-8 text');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (cause) {
    throw new ExecutionError('BINARY_FILE', 'This file is not supported UTF-8 text', { cause });
  }
}

async function readBytes(
  path: string,
  signal: AbortSignal,
  maximum = MAXIMUM_FILE_BYTES,
): Promise<Buffer> {
  checkCancelled(signal);
  const handle = await openRegular(path, maximum);
  try {
    const before = await handle.stat();
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      checkCancelled(signal);
      const chunk = await handle.read(buffer, length, buffer.length - length, length);
      if (chunk.bytesRead === 0) break;
      length += chunk.bytesRead;
    }
    const data = buffer.subarray(0, length);
    const after = await handle.stat();
    if (data.length > maximum)
      throw new ExecutionError('FILE_TOO_LARGE', 'File grew beyond its size limit');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new ExecutionError('FILE_CHANGED', 'File changed while reading');
    return data;
  } finally {
    await handle.close();
  }
}

function imageMime(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.subarray(0, 6).toString() === 'GIF87a' || data.subarray(0, 6).toString() === 'GIF89a')
    return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return undefined;
}

export async function readFileTool(
  args: Record<string, unknown>,
  root: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const input = stringArgument(args, 'path');
  const path = await workspacePath(root, input);
  const data = await readBytes(path, context.signal);
  const mimeType = imageMime(data);
  if (mimeType)
    return {
      summary: `Read image ${input}`,
      content: [
        { type: 'text', text: `Image: ${input}` },
        { type: 'image', data: data.toString('base64'), mimeType },
      ],
    };
  if (data.subarray(0, 5).toString() === '%PDF-') {
    const text = await extractPdf(data, context.signal);
    return textResult(`Read PDF ${input}`, text);
  }
  if (data.length > MAXIMUM_TEXT_BYTES)
    throw new ExecutionError('FILE_TOO_LARGE', 'Text file exceeds its 500000-byte limit');
  const text = decodeText(data);
  const lines = text.split('\n');
  const startLine = Number(args['startLine'] ?? 1);
  const maxLines = Number(args['maxLines'] ?? 300);
  const selected = lines
    .slice(startLine - 1, startLine - 1 + maxLines)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
  const truncated =
    startLine - 1 + maxLines < lines.length || selected.length > MAXIMUM_OUTPUT_CHARACTERS;
  return textResult(
    `Read ${input}`,
    `SHA-256: ${hashBytes(data)}\nLines: ${lines.length}\n${selected.slice(0, MAXIMUM_OUTPUT_CHARACTERS)}${truncated ? '\n[Output truncated]' : ''}`,
  );
}

interface ListedEntry {
  path: string;
  directory: boolean;
}

async function walk(
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

export async function listFilesTool(
  args: Record<string, unknown>,
  root: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const path = await workspacePath(root, stringArgument(args, 'path', '.'));
  const result = await walk(
    root,
    path,
    args['recursive'] === true,
    context.signal,
    Number(args['maxEntries'] ?? 200),
  );
  return textResult(
    `Listed ${result.entries.length} entries`,
    `${result.entries.map((entry) => `${entry.path}${entry.directory ? '/' : ''}`).join('\n')}${result.truncated ? '\n[Listing truncated]' : ''}`,
  );
}

export async function searchFilesTool(
  args: Record<string, unknown>,
  root: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const path = await workspacePath(root, stringArgument(args, 'path', '.'));
  const info = await stat(path);
  const listed = info.isDirectory()
    ? await walk(root, path, true, context.signal, 1000)
    : {
        entries: [{ path: toWorkspaceRelativePath(root, path), directory: false }],
        truncated: false,
      };
  const maximum = Number(args['maxResults'] ?? 50);
  const sensitive = args['caseSensitive'] === true;
  const originalQuery = stringArgument(args, 'query');
  const query = sensitive ? originalQuery : originalQuery.toLowerCase();
  const matches: string[] = [];
  let truncated = listed.truncated;
  let bytesRead = 0;
  for (const entry of listed.entries) {
    checkCancelled(context.signal);
    if (entry.directory) continue;
    const target = await workspacePath(root, entry.path);
    if ((await stat(target)).size > MAXIMUM_TEXT_BYTES) continue;
    let content: string;
    try {
      const bytes = await readBytes(target, context.signal, MAXIMUM_TEXT_BYTES);
      bytesRead += bytes.length;
      if (bytesRead > 10_000_000) {
        truncated = true;
        break;
      }
      content = decodeText(bytes);
    } catch (error) {
      if (error instanceof ExecutionError && error.code === 'BINARY_FILE') continue;
      throw error;
    }
    for (const [index, line] of content.split('\n').entries()) {
      if ((sensitive ? line : line.toLowerCase()).includes(query)) {
        matches.push(`${entry.path}:${index + 1}: ${line.slice(0, 1000)}`);
        if (matches.length >= maximum) {
          truncated = true;
          break;
        }
      }
    }
    if (matches.length >= maximum) break;
  }
  return textResult(
    `Found ${matches.length} matches`,
    `${matches.join('\n')}${truncated ? '\n[Search truncated]' : ''}`,
  );
}

async function currentContent(path: string, signal: AbortSignal): Promise<Buffer | null> {
  try {
    return await readBytes(path, signal, MAXIMUM_TEXT_BYTES);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function assertPreimage(current: Buffer | null, expectedHash: unknown): void {
  const digest = current === null ? null : hashBytes(current);
  if (digest !== expectedHash)
    throw new ExecutionError(
      'PREIMAGE_MISMATCH',
      'The file changed or its expected hash does not match. Read it again before writing',
    );
}

async function replaceFile(
  path: string,
  root: string,
  content: string,
  original: Buffer | null,
  context: ExecutionContext,
): Promise<void> {
  checkCancelled(context.signal);
  const parent = dirname(path);
  const before = await lstat(parent);
  const existing = original === null ? undefined : await lstat(path);
  if (existing && existing.nlink !== 1)
    throw new ExecutionError('HARDLINK_FILE', 'Files with multiple hard links cannot be modified');
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
    await workspacePath(root, toWorkspaceRelativePath(root, path), true);
    const after = await lstat(parent);
    if (before.dev !== after.dev || before.ino !== after.ino)
      throw new ExecutionError('FILE_CHANGED', 'The parent directory changed before writing');
    assertPreimage(
      await currentContent(path, context.signal),
      original === null ? null : hashBytes(original),
    );
    if (original === null) {
      // link() is an atomic create-if-absent; rename() could replace a concurrent creation.
      const { link } = await import('node:fs/promises');
      await link(temporary, path);
    } else await rename(temporary, path);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

export async function writeFileTool(
  name: 'write_file' | 'edit_file',
  args: Record<string, unknown>,
  root: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  if (context.readOnly)
    throw new ExecutionError('READ_ONLY', 'File changes are disabled by the current policy');
  const input = stringArgument(args, 'path');
  const path = await workspacePath(root, input, name === 'write_file');
  const current = await currentContent(path, context.signal);
  assertPreimage(current, args['expectedHash']);
  const before = current === null ? '' : decodeText(current);
  let after = stringArgument(args, 'content');
  if (name === 'edit_file') {
    if (current === null)
      throw new ExecutionError('FILE_MISSING', 'The file to edit does not exist');
    const oldText = stringArgument(args, 'oldText');
    const parts = before.split(oldText);
    const count = parts.length - 1;
    if (count === 0 || (count > 1 && args['replaceAll'] !== true))
      throw new ExecutionError(
        'EDIT_AMBIGUOUS',
        'The old text must match exactly once unless replaceAll is enabled',
      );
    after = parts.join(stringArgument(args, 'newText'));
  }
  if (Buffer.byteLength(after) > MAXIMUM_TEXT_BYTES)
    throw new ExecutionError('FILE_TOO_LARGE', 'The resulting file exceeds 500000 bytes');
  const diff = createPatch(input, before, after, '', '', {
    context: 3,
    maxEditLength: 20_000,
    timeout: 1000,
  });
  if (diff === undefined || diff.length > MAXIMUM_OUTPUT_CHARACTERS)
    throw new ExecutionError('DIFF_LIMIT', 'The change is too large to produce a bounded diff');
  await replaceFile(path, root, after, current, context);
  return textResult(`Wrote ${input}`, `SHA-256: ${hashBytes(Buffer.from(after))}\n${diff}`, diff);
}
