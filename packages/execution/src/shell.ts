import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ExecutionError, checkCancelled } from './errors.js';
import { collectShellProcess } from './shell-process.js';
import type { ExecutionContext, ExecutionResult } from './types.js';

const MAXIMUM_OUTPUT_BYTES = 100_000;

export function sandboxProfile(
  root: string,
  temporary: string,
  runtimeDirectory: string,
  privateDirectory: string,
): string {
  const subpath = (path: string): string => `(subpath ${JSON.stringify(path)})`;
  const reads = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/Library/Apple',
    '/opt/homebrew',
    '/private/var/db/dyld',
    root,
    temporary,
    runtimeDirectory,
  ];
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* ${reads.map(subpath).join(' ')} (literal "/") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/etc/localtime") (literal "/etc/passwd"))
(allow file-write* ${subpath(root)} ${subpath(temporary)} (literal "/dev/null") (subpath "/dev/fd"))
(deny file-read* ${subpath(privateDirectory)})
(deny file-write* ${subpath(privateDirectory)})
(deny file-read* (regex #"/(\\.ssh|\\.aws|\\.gnupg|\\.kube|\\.npmrc|\\.netrc|\\.git-credentials|\\.env[^/]*|\\.[mM][yY]-[pP][iI]-[hH][aA][rR][nN][eE][sS][sS])(/|$)"))
(deny file-write* (regex #"/(\\.ssh|\\.aws|\\.gnupg|\\.kube|\\.npmrc|\\.netrc|\\.git-credentials|\\.env[^/]*|\\.git|\\.[mM][yY]-[pP][iI]-[hH][aA][rR][nN][eE][sS][sS])(/|$)"))
`;
}

/** macOS shell policy is frozen by the caller; both modes settle the owned process group. */
export async function shellTool(
  args: Record<string, unknown>,
  root: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  if (context.readOnly)
    throw new ExecutionError('READ_ONLY', 'Shell execution is disabled by the current policy');
  if (process.platform !== 'darwin')
    throw new ExecutionError(
      'SANDBOX_UNAVAILABLE',
      'Shell execution is not supported on this platform',
    );
  checkCancelled(context.signal);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-shell-')));
  try {
    const runtimeDirectory = dirname(await realpath(process.execPath));
    const shellArguments = ['--noprofile', '--norc', '-c', String(args['command'])];
    const fullAccess = context.shellAccess === 'full-access';
    const home = fullAccess ? await realpath(homedir()) : temporary;
    let program = '/bin/bash';
    let commandArguments = shellArguments;
    if (!fullAccess) {
      const privateDirectory = await realpath(context.profileDirectory);
      program = '/usr/bin/sandbox-exec';
      commandArguments = [
        '-p',
        sandboxProfile(root, temporary, runtimeDirectory, privateDirectory),
        '/bin/bash',
        ...shellArguments,
      ];
    }
    checkCancelled(context.signal);
    const child = spawn(program, commandArguments, {
      cwd: root,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${runtimeDirectory}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`,
        HOME: home,
        TMPDIR: temporary,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    const { code, signal, output } = await collectShellProcess(
      child,
      context.signal,
      Number(args['timeoutMs'] ?? 30_000),
    );
    if (code !== 0)
      throw new ExecutionError(
        'SHELL_FAILED',
        `Shell exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}\n${output.slice(0, MAXIMUM_OUTPUT_BYTES)}`,
      );
    return {
      summary: 'Shell command completed',
      content: [{ type: 'text', text: output || '[Command completed without output]' }],
    };
  } finally {
    try {
      await rm(temporary, { recursive: true, force: true });
    } catch (cause) {
      throw new ExecutionError(
        'PROCESS_CLEANUP_FAILED',
        'Shell temporary directory could not be removed',
        { cause },
      );
    }
  }
}
