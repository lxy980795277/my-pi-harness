import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ExecutionError,
  openRegular,
  parseWorkspaceRelativePath,
  resolveWorkspaceRoot,
  toWorkspaceRelativePath,
  workspacePath,
} from '@my-pi-harness/execution';
import type { RuleSource } from '@my-pi-harness/protocol';
import { abortError, RuntimeError } from '../errors.js';

const MAXIMUM_RULES = 16;
const MAXIMUM_RULE_BYTES = 65_536;
const MAXIMUM_REFERENCE_PATHS = 64;

export interface WorkspaceRulesInput {
  workspaceRoot: string;
  profileDirectory: string;
  referencePaths?: readonly string[];
  signal: AbortSignal;
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readRule(
  root: string,
  relativePath: string,
  remainingBytes: number,
  signal: AbortSignal,
): Promise<RuleSource | undefined> {
  let path: string;
  try {
    path = await workspacePath(root, relativePath);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  checkCancelled(signal);
  const handle = await openRegular(path, remainingBytes);
  try {
    const before = await handle.stat();
    const buffer = Buffer.alloc(remainingBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      checkCancelled(signal);
      const chunk = await handle.read(buffer, length, buffer.length - length, length);
      if (chunk.bytesRead === 0) break;
      length += chunk.bytesRead;
    }
    if (length > remainingBytes)
      throw new RuntimeError('RULE_LIMIT', '项目规则总量超过64 KiB，请缩短AGENTS.md。');
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new RuntimeError('RULE_CHANGED', 'AGENTS.md在读取期间发生变化，请重试。');
    checkCancelled(signal);
    const bytes = buffer.subarray(0, length);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new RuntimeError('INVALID_RULE_FILE', 'AGENTS.md必须为UTF-8文本。', { cause });
    }
    if (content.includes('\0'))
      throw new RuntimeError('INVALID_RULE_FILE', 'AGENTS.md必须为不含空字节的UTF-8文本。');
    return {
      path: relativePath,
      hash: createHash('sha256').update(bytes).digest('hex'),
      content,
      byteLength: length,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Load root rules and ancestors of explicit references, without scanning other directories.
 * Paths are workspace-relative; links, protected paths and non-UTF-8/oversized rules fail.
 */
export async function loadWorkspaceRules(input: WorkspaceRulesInput): Promise<RuleSource[]> {
  checkCancelled(input.signal);
  const references = input.referencePaths ?? [];
  if (references.length > MAXIMUM_REFERENCE_PATHS)
    throw new RuntimeError('RULE_LIMIT', '单次运行引用的规则路径过多。');
  const root = await resolveWorkspaceRoot({
    rootPath: input.workspaceRoot,
    profileDirectory: input.profileDirectory,
    signal: input.signal,
  });
  if (root !== resolve(input.workspaceRoot))
    throw new RuntimeError('WORKSPACE_CHANGED', '工作区目录已变化，请重新选择工作区。');
  const directories = new Set<string>(['.']);
  for (const reference of references) {
    checkCancelled(input.signal);
    const components = parseWorkspaceRelativePath(reference);
    if (components.length > 64) throw new RuntimeError('RULE_LIMIT', '引用路径层级过深。');
    const target = resolve(root, ...components);
    let directory = components.length === 0 ? root : dirname(target);
    try {
      const checked = await workspacePath(root, reference);
      if ((await lstat(checked)).isDirectory()) directory = checked;
    } catch (error) {
      // Frozen references survive deleted sources; each candidate rule still checks its ancestors.
      if (!isMissing(error)) throw error;
    }
    while (directory !== root) {
      directories.add(toWorkspaceRelativePath(root, directory));
      directory = dirname(directory);
    }
  }
  const ordered = [...directories].sort((left, right) => {
    const leftDepth = left === '.' ? 0 : left.split('/').length;
    const rightDepth = right === '.' ? 0 : right.split('/').length;
    return leftDepth - rightDepth || left.localeCompare(right, 'en');
  });
  const rules: RuleSource[] = [];
  let byteLength = 0;
  for (const directory of ordered) {
    const path = directory === '.' ? 'AGENTS.md' : `${directory}/AGENTS.md`;
    let rule: RuleSource | undefined;
    try {
      rule = await readRule(root, path, MAXIMUM_RULE_BYTES - byteLength, input.signal);
    } catch (cause) {
      if (cause instanceof ExecutionError && cause.code === 'FILE_TOO_LARGE')
        throw new RuntimeError('RULE_LIMIT', '项目规则总量超过64 KiB，请缩短AGENTS.md。', {
          cause,
        });
      throw cause;
    }
    if (!rule) continue;
    if (rules.length >= MAXIMUM_RULES)
      throw new RuntimeError('RULE_LIMIT', '单次运行的AGENTS.md文件不能超过16个。');
    rules.push(rule);
    byteLength += rule.byteLength;
  }
  checkCancelled(input.signal);
  return rules;
}
