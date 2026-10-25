import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SkillError } from './errors.js';
import {
  checkedSkillDirectory,
  prepareSkillDirectory,
  readSkillTree,
  skillResourcePath,
  writeOwnedSkillFile,
  syncSkillDirectory,
} from './files.js';
import { parseSkill } from './parser.js';
import type { SkillDownloadFile } from './types.js';

/** Install only a new owned directory; cancellation never enables a partial tree. */
export async function installSkillFiles(
  root: string,
  name: string,
  files: readonly SkillDownloadFile[],
  signal: AbortSignal,
): Promise<string> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw new SkillError('SKILL_NAME', 'Invalid Skill directory name');
  if (files.length === 0 || files.length > 256)
    throw new SkillError('SKILL_LIMIT', 'Invalid Skill file count');
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    skillResourcePath(file.path);
    if (paths.has(file.path) || file.content.length > 2 * 1024 * 1024)
      throw new SkillError('SKILL_RESOURCE', 'Duplicate or oversized Skill resource');
    paths.add(file.path);
    total += file.content.length;
  }
  if (total > 16 * 1024 * 1024) throw new SkillError('SKILL_LIMIT', 'Skill exceeds 16 MiB');
  const main = files.find((file) => file.path === 'SKILL.md');
  if (!main) throw new SkillError('SKILL_FORMAT', 'Source does not contain SKILL.md');
  parseSkill(new TextDecoder('utf-8', { fatal: true }).decode(main.content), name);
  signal.throwIfAborted();
  await prepareSkillDirectory(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await checkedSkillDirectory(root);
  const target = join(root, name);
  try {
    await lstat(target);
    throw new SkillError('SKILL_CONFLICT', 'A Skill with this name already exists');
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const staging = join(root, `.install-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    const directories = new Set([staging]);
    for (const file of files) {
      signal.throwIfAborted();
      const path = join(staging, file.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      let parent = dirname(path);
      while (parent.length >= staging.length) {
        directories.add(parent);
        if (parent === staging) break;
        parent = dirname(parent);
      }
      await writeOwnedSkillFile(path, file.content, 0o600, signal);
    }
    await readSkillTree(staging, signal);
    for (const directory of [...directories].sort((a, b) => b.length - a.length))
      await syncSkillDirectory(directory);
    signal.throwIfAborted();
    try {
      await rename(staging, target);
      await syncSkillDirectory(root);
    } catch (cause) {
      if (
        cause instanceof Error &&
        'code' in cause &&
        ['EEXIST', 'ENOTEMPTY'].includes(String(cause.code))
      )
        throw new SkillError('SKILL_CONFLICT', 'A Skill with this name already exists', { cause });
      throw cause;
    }
    return target;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
