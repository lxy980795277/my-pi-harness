import { constants } from 'node:fs';
import { access, lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, parse, posix, relative, resolve, sep, win32 } from 'node:path';
import { SandboxError, checkCancelled, isMissing } from '../errors.js';
import { isSensitiveName } from '../policy/protected-paths.js';

export type WorkspacePathPlatform = 'posix' | 'win32';

/** Canonical workspace and private data root supplied by the host. */
export interface WorkspaceContext {
  workspaceRoot: string;
  profileDirectory: string;
  signal: AbortSignal;
}

/** Registration accepts directory aliases and stores this resolved identity for execution. */
export interface WorkspaceRootInput {
  rootPath: string;
  profileDirectory: string;
  signal?: AbortSignal;
}

function isWithin(root: string, target: string): boolean {
  const difference = relative(root, target);
  return (
    difference === '' ||
    (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
  );
}

export function isPortableFileName(name: string): boolean {
  return (
    !/[<>:"\\|?*\u0000-\u001f\u007f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  );
}

/** Shared registration/execution policy; errors never expose filesystem or profile details. */
export async function resolveWorkspaceRoot(input: WorkspaceRootInput): Promise<string> {
  if (input.signal) checkCancelled(input.signal);
  if (!isAbsolute(input.rootPath) || !isAbsolute(input.profileDirectory)) {
    throw new SandboxError(
      'INVALID_WORKSPACE',
      'Workspace and profile directories must be absolute',
    );
  }
  try {
    const root = await realpath(input.rootPath);
    const profile = await realpath(input.profileDirectory);
    const home = await realpath(homedir());
    if (
      root === parse(root).root ||
      isWithin(root, home) ||
      isWithin(root, profile) ||
      isWithin(profile, root)
    ) {
      throw new SandboxError(
        'PROTECTED_PATH',
        'This directory overlaps a protected application or home directory',
      );
    }
    if (!(await stat(root)).isDirectory())
      throw new SandboxError('INVALID_WORKSPACE', 'Workspace is not a directory');
    if (root.split(sep).some(isSensitiveName))
      throw new SandboxError('PROTECTED_PATH', 'Workspace is inside a protected directory');
    await access(root, constants.R_OK);
    if (input.signal) checkCancelled(input.signal);
    return root;
  } catch (cause) {
    if (cause instanceof SandboxError) throw cause;
    throw new SandboxError('INVALID_WORKSPACE', 'Workspace directory is missing or inaccessible', {
      cause,
    });
  }
}

/** Execution additionally requires the canonical identity saved during registration. */
export async function canonicalWorkspace(context: WorkspaceContext): Promise<string> {
  const root = await resolveWorkspaceRoot({
    rootPath: context.workspaceRoot,
    profileDirectory: context.profileDirectory,
    signal: context.signal,
  });
  if (root !== resolve(context.workspaceRoot)) {
    throw new SandboxError(
      'WORKSPACE_CHANGED',
      'The registered workspace path now resolves to a different directory',
    );
  }
  return root;
}

/** Convert host-owned relative paths before applying the model's forward-slash policy. */
export function toWorkspaceRelativePath(
  root: string,
  target: string,
  platform: WorkspacePathPlatform = process.platform === 'win32' ? 'win32' : 'posix',
): string {
  const api = platform === 'win32' ? win32 : posix;
  return api.relative(root, target).split(api.sep).join('/') || '.';
}

/** Keep model paths unambiguous on both NTFS and POSIX, without touching the filesystem. */
export function parseWorkspaceRelativePath(input: string): string[] {
  if (
    input.length === 0 ||
    input.includes('\\') ||
    posix.isAbsolute(input) ||
    win32.isAbsolute(input) ||
    /^[a-z]:/i.test(input)
  ) {
    throw new SandboxError('INVALID_PATH', 'Use a workspace-relative path with forward slashes');
  }
  const parts = input.split('/').filter((part) => part !== '' && part !== '.');
  for (const part of parts) {
    if (part === '..' || isSensitiveName(part)) {
      throw new SandboxError(
        'PROTECTED_PATH',
        'The requested path is outside the allowed workspace files',
      );
    }
    if (!isPortableFileName(part)) {
      throw new SandboxError(
        'INVALID_PATH',
        'The requested path contains an unsafe or ambiguous filename',
      );
    }
  }
  return parts;
}

/** Model paths are relative; every existing component is checked without following links. */
export async function workspacePath(
  root: string,
  input: string,
  allowMissing = false,
): Promise<string> {
  const parts = parseWorkspaceRelativePath(input);
  const target = resolve(root, ...parts);
  if (!isWithin(root, target))
    throw new SandboxError('OUTSIDE_WORKSPACE', 'Path is outside the workspace');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink())
        throw new SandboxError(
          'SYMLINK_PATH',
          'Symbolic links are not accepted for workspace paths',
        );
      if (index < parts.length - 1 && !entry.isDirectory())
        throw new SandboxError('INVALID_PATH', 'A path component is not a directory');
    } catch (error) {
      if (allowMissing && index === parts.length - 1 && isMissing(error)) return target;
      throw error;
    }
  }
  const actual = await realpath(target);
  if (!isWithin(root, actual))
    throw new SandboxError('OUTSIDE_WORKSPACE', 'Resolved path is outside the workspace');
  return actual;
}

/** Hold the checked inode while reading. Parent rename races still require OS isolation. */
export async function openRegular(path: string, maximum: number): Promise<FileHandle> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new SandboxError('NOT_REGULAR_FILE', 'Only regular files are supported');
  if (before.nlink !== 1)
    throw new SandboxError('HARDLINK_FILE', 'Files with multiple hard links cannot be accessed');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const entry = await handle.stat();
    if (
      !entry.isFile() ||
      entry.dev !== before.dev ||
      entry.ino !== before.ino ||
      entry.nlink !== 1
    )
      throw new SandboxError('FILE_CHANGED', 'The file changed while opening');
    if (entry.size > maximum)
      throw new SandboxError('FILE_TOO_LARGE', `File exceeds the ${maximum}-byte limit`);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export { isSensitiveName } from '../policy/protected-paths.js';
