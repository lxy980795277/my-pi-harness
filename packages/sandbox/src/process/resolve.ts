import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { SandboxError } from '../errors';
import { resolveWorkspaceRoot } from '../filesystem/workspace-path';
import { isAllowedProcessEnvironmentName } from './environment';
import type { ProcessInput, ProcessLaunch, ProcessLimits } from './types';

const DEFAULT_LIMITS: Required<Omit<ProcessLimits, 'lifetimeMs'>> = {
  stdoutBytes: 64 * 1024 * 1024,
  stdoutBytesPerSecond: 4 * 1024 * 1024,
  stdoutBurstBytes: 8 * 1024 * 1024,
  stderrBytes: 4 * 1024 * 1024,
  stderrBytesPerSecond: 256 * 1024,
  stderrBurstBytes: 512 * 1024,
  diagnosticBytes: 64 * 1024,
  queuedWriteBytes: 4 * 1024 * 1024,
  terminateGraceMs: 2000,
  killWaitMs: 5000,
  pipeCloseMs: 5000,
};

function contains(root: string, path: string): boolean {
  const difference = relative(root, path);
  return (
    difference === '' ||
    (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
  );
}

/** Resolve a launch without spawning; startProcess rechecks these observed identities. */
export async function resolveProcess(input: ProcessInput): Promise<ProcessLaunch> {
  if (process.platform !== 'darwin')
    throw new SandboxError(
      'SANDBOX_UNAVAILABLE',
      'Local process execution is unavailable on this platform',
    );
  if (!isAbsolute(input.command))
    throw new SandboxError('INVALID_PROGRAM', 'The program must be an absolute executable path');
  const workspaceRoot = await resolveWorkspaceRoot({
    rootPath: input.workspaceRoot,
    profileDirectory: input.profileDirectory,
  });
  if (workspaceRoot !== input.workspaceRoot)
    throw new SandboxError('WORKSPACE_CHANGED', 'The registered workspace root changed');
  const workspaceEntry = await stat(workspaceRoot);
  const profileDirectory = await realpath(input.profileDirectory);
  let command: string;
  let file;
  try {
    command = await realpath(input.command);
    file = await stat(command);
    await access(command, constants.X_OK);
  } catch (cause) {
    throw new SandboxError('INVALID_PROGRAM', 'The executable is missing or inaccessible', {
      cause,
    });
  }
  if (!file.isFile())
    throw new SandboxError('INVALID_PROGRAM', 'The program must be a regular executable');
  for (const [name, value] of Object.entries(input.environment))
    if (!isAllowedProcessEnvironmentName(name) || value.includes('\0'))
      throw new SandboxError(
        'INVALID_ENVIRONMENT',
        'A launch-control environment variable is not allowed',
      );
  if (input.args.some((value) => value.includes('\0')))
    throw new SandboxError('INVALID_PROGRAM', 'Program arguments cannot contain NUL');
  const argumentIdentities: ProcessLaunch['argumentIdentities'][number][] = [];
  for (const argument of input.args) {
    if (!isAbsolute(argument)) continue;
    let target;
    try {
      target = await stat(argument);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (target.isFile())
      argumentIdentities.push({
        path: await realpath(argument),
        device: target.dev,
        inode: target.ino,
        size: target.size,
        modifiedMs: target.mtimeMs,
      });
  }
  const readOnlyDirectories: string[] = [];
  const resourceIdentities: ProcessLaunch['resourceIdentities'][number][] = [];
  for (const directory of input.readOnlyDirectories ?? []) {
    if (!isAbsolute(directory))
      throw new SandboxError('INVALID_RESOURCE', 'Read-only resource directories must be absolute');
    const path = await realpath(directory);
    const entry = await lstat(directory);
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      path !== directory ||
      contains(path, profileDirectory) ||
      contains(profileDirectory, path)
    )
      throw new SandboxError(
        'INVALID_RESOURCE',
        'Read-only resources must be canonical directories outside private application data',
      );
    await access(path, constants.R_OK);
    readOnlyDirectories.push(path);
    resourceIdentities.push({ path, device: entry.dev, inode: entry.ino });
  }
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
      throw new SandboxError('INVALID_LIMIT', 'Process limits must be positive bounded integers');
  if (limits.terminateGraceMs + limits.killWaitMs + limits.pipeCloseMs + 1000 > 2_147_483_647)
    throw new SandboxError('INVALID_LIMIT', 'The combined process cleanup deadline is too large');
  const processAccess =
    input.access ?? (input.scope === 'full-access' ? 'full-access' : 'workspace-write');
  return {
    ...input,
    resolvedCommand: command,
    workspaceRoot,
    profileDirectory,
    access: processAccess,
    args: [...input.args],
    environment: { ...input.environment },
    readOnlyDirectories,
    resourceIdentities,
    argumentIdentities,
    limits,
    workspaceIdentity: { device: workspaceEntry.dev, inode: workspaceEntry.ino },
    programIdentity: {
      device: file.dev,
      inode: file.ino,
      size: file.size,
      modifiedMs: file.mtimeMs,
    },
  };
}
