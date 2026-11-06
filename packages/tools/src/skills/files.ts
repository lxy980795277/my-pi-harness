import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { SkillError } from './errors.js';
import type { SkillDownloadFile, SkillResource } from './types.js';

/** Resource names are portable relative paths with no traversal or hidden credential paths. */
export function skillResourcePath(input: string): string {
  if (
    input.length === 0 ||
    input.length > 512 ||
    isAbsolute(input) ||
    input.includes('\\') ||
    input
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))
  )
    throw new SkillError('SKILL_PATH', 'Invalid Skill resource path');
  return input;
}
export function skillHash(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function resourceMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.md':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}
/** Reject links in every existing path component instead of following a source symlink. */
export async function checkedSkillDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  const canonical = await realpath(absolute);
  if (canonical !== absolute)
    throw new SkillError('SKILL_SYMLINK', 'Skill directories must not contain symlinks');
  const status = await lstat(absolute);
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new SkillError('SKILL_PATH', 'Skill root is not a regular directory');
  return canonical;
}
/** Check existing ancestors before creating a managed installation directory. */
export async function prepareSkillDirectory(path: string): Promise<void> {
  let existing = resolve(path);
  while (true) {
    try {
      await lstat(existing);
      break;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = dirname(existing);
      if (parent === existing)
        throw new SkillError('SKILL_PATH', 'No existing Skill directory ancestor');
      existing = parent;
    }
  }
  await checkedSkillDirectory(existing);
}
/** Bounded reads use a no-follow descriptor and verify the file did not change during the read. */
export async function readSkillFile(
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const safe = skillResourcePath(path);
  const target = resolve(root, safe);
  const location = relative(root, target);
  if (location.startsWith(`..${sep}`) || location === '..' || isAbsolute(location))
    throw new SkillError('SKILL_PATH', 'Resource leaves its Skill directory');
  const canonical = await realpath(target);
  if (canonical !== target)
    throw new SkillError('SKILL_SYMLINK', 'Skill resources cannot be symlinks');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 2 * 1024 * 1024)
      throw new SkillError(
        'SKILL_RESOURCE',
        'Skill resource must be a regular file no larger than 2 MiB',
      );
    const bytes = await handle.readFile({ signal });
    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      bytes.length !== before.size
    )
      throw new SkillError('SKILL_CHANGED', 'Skill resource changed during reading');
    return bytes;
  } finally {
    await handle.close();
  }
}
/** Enumerate a bounded source tree without traversing linked directories. */
export async function readSkillTree(
  directory: string,
  signal: AbortSignal,
): Promise<SkillDownloadFile[]> {
  const root = await checkedSkillDirectory(directory);
  const files: SkillDownloadFile[] = [];
  let total = 0;
  let entriesRead = 0;
  async function visit(path: string, depth: number): Promise<void> {
    signal.throwIfAborted();
    if (depth > 8) throw new SkillError('SKILL_LIMIT', 'Skill nesting exceeds 8 levels');
    const entries = await readdir(resolve(root, path), { withFileTypes: true });
    for (const entry of entries) {
      entriesRead += 1;
      if (entriesRead > 512)
        throw new SkillError('SKILL_LIMIT', 'Skill tree contains too many directory entries');
      if (entry.name.startsWith('.'))
        throw new SkillError('SKILL_PATH', 'Hidden files are not accepted in managed Skills');
      const child = path.length === 0 ? entry.name : `${path}/${entry.name}`;
      skillResourcePath(child);
      if (entry.isSymbolicLink())
        throw new SkillError('SKILL_SYMLINK', 'Skill resources cannot contain symlinks');
      if (entry.isDirectory()) {
        await visit(child, depth + 1);
        continue;
      }
      if (!entry.isFile())
        throw new SkillError('SKILL_RESOURCE', 'Skill resources must be regular files');
      const content = await readSkillFile(root, child, signal);
      total += content.length;
      files.push({ path: child, content });
      if (total > 16 * 1024 * 1024 || files.length > 256)
        throw new SkillError('SKILL_LIMIT', 'Skill tree exceeds the file or byte limit');
    }
  }
  await visit('', 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function resourceIndex(files: readonly SkillDownloadFile[]): SkillResource[] {
  return files
    .filter((file) => file.path !== 'SKILL.md')
    .map((file) => ({
      path: file.path,
      hash: skillHash(file.content),
      size: file.content.length,
      mediaType: resourceMediaType(file.path),
    }));
}

/** Persist immutable or staged bytes before their version enters SQLite or a session log. */
export async function writeOwnedSkillFile(
  path: string,
  bytes: Uint8Array,
  mode: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(bytes);
    signal.throwIfAborted();
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Directory metadata must be durable before exposing the newly renamed version. */
export async function syncSkillDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
