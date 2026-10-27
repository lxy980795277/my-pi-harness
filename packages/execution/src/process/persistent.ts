import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { ExecutionError, checkCancelled } from '../core/errors.js';
import { stopOwnedProcessGroup, waitForProcessClose } from './cleanup.js';
import { sandboxProfile } from './sandbox.js';
import { resolveWorkspaceRoot } from '../filesystem/workspace-path.js';

export type ProcessScope = 'sandboxed' | 'full-access';

export interface PersistentProcessInput {
  command: string;
  args: readonly string[];
  workspaceRoot: string;
  profileDirectory: string;
  environment: Readonly<Record<string, string>>;
  scope: ProcessScope;
}

export interface PersistentProcessLaunch extends PersistentProcessInput {
  argumentIdentities: readonly {
    path: string;
    device: number;
    inode: number;
    size: number;
    modifiedMs: number;
  }[];
  programIdentity: { device: number; inode: number; size: number; modifiedMs: number };
}

export interface PersistentProcessObserver {
  stdout(chunk: Buffer): void;
  stdoutEnd(): void;
  fault(error: ExecutionError): void;
}

export interface PersistentProcess {
  readonly closed: Promise<void>;
  /** Cancellation is checked again after queuing and immediately before stdin.write. */
  write(
    bytes: Uint8Array,
    options: { signal: AbortSignal; beforeWrite?: () => void },
  ): Promise<void>;
  diagnostics(): string;
  /** Rejects future writes synchronously and waits for process group, pipes and temporary directory. */
  close(): Promise<void>;
}

const CONTROL_ENVIRONMENT =
  /^(?:PATH|HOME|TMPDIR|TMP|TEMP|SHELL|ENV|BASH_ENV|NODE_.*|LD_.*|DYLD_.*|PYTHON.*|RUBY.*|PERL.*|ZDOTDIR|GIT_.*)$/i;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const STDERR_RING_BYTES = 64 * 1024;

/** Resolves executable identity and registered root without starting a program. */
export async function resolvePersistentProcess(
  input: PersistentProcessInput,
): Promise<PersistentProcessLaunch> {
  if (process.platform !== 'darwin')
    throw new ExecutionError(
      'SANDBOX_UNAVAILABLE',
      'Persistent local tools are unavailable on this platform',
    );
  if (!isAbsolute(input.command))
    throw new ExecutionError('INVALID_PROGRAM', 'The program must be an absolute executable path');
  const workspaceRoot = await resolveWorkspaceRoot({
    rootPath: input.workspaceRoot,
    profileDirectory: input.profileDirectory,
  });
  if (workspaceRoot !== input.workspaceRoot)
    throw new ExecutionError('WORKSPACE_CHANGED', 'The registered workspace root changed');
  const command = await realpath(input.command);
  const file = await stat(command);
  if (!file.isFile())
    throw new ExecutionError('INVALID_PROGRAM', 'The program must be a regular executable');
  await access(command, constants.X_OK);
  for (const [name, value] of Object.entries(input.environment)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      CONTROL_ENVIRONMENT.test(name) ||
      value.includes('\0')
    ) {
      throw new ExecutionError(
        'INVALID_ENVIRONMENT',
        'A launch-control environment variable is not allowed',
      );
    }
  }
  if (input.args.some((value) => value.includes('\0')))
    throw new ExecutionError('INVALID_PROGRAM', 'Program arguments cannot contain NUL');
  const argumentIdentities: PersistentProcessLaunch['argumentIdentities'][number][] = [];
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
  return {
    ...input,
    argumentIdentities,
    args: [...input.args],
    environment: { ...input.environment },
    command,
    workspaceRoot,
    programIdentity: {
      device: file.dev,
      inode: file.ino,
      size: file.size,
      modifiedMs: file.mtimeMs,
    },
  };
}

class ByteBudget {
  #tokens: number;
  #time = performance.now();
  #total = 0;
  public constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly maximum: number,
  ) {
    this.#tokens = burst;
  }
  public accept(bytes: number): boolean {
    const now = performance.now();
    this.#tokens = Math.min(this.burst, this.#tokens + ((now - this.#time) * this.rate) / 1000);
    this.#time = now;
    this.#total += bytes;
    this.#tokens -= bytes;
    return this.#tokens >= 0 && this.#total <= this.maximum;
  }
}

/** Starts a bounded duplex process. The returned owner never exposes ChildProcess to integrations. */
export async function startPersistentProcess(
  launch: PersistentProcessLaunch,
  observer: PersistentProcessObserver,
  signal: AbortSignal,
  secrets: readonly string[] = [],
): Promise<PersistentProcess> {
  checkCancelled(signal);
  const current = await resolvePersistentProcess(launch);
  if (
    JSON.stringify(current.programIdentity) !== JSON.stringify(launch.programIdentity) ||
    JSON.stringify(current.argumentIdentities) !== JSON.stringify(launch.argumentIdentities) ||
    current.command !== launch.command
  ) {
    throw new ExecutionError(
      'PROGRAM_CHANGED',
      'The executable changed after startup authorization',
    );
  }
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-mcp-')));
  let owned: PersistentProcess | undefined;
  try {
    const runtimeDirectory = dirname(await realpath(process.execPath));
    const privateDirectory = await realpath(launch.profileDirectory);
    const full = launch.scope === 'full-access';
    const home = full ? await realpath(homedir()) : temporary;
    checkCancelled(signal);
    const child = spawn(
      full ? launch.command : '/usr/bin/sandbox-exec',
      full
        ? [...launch.args]
        : [
            '-p',
            sandboxProfile(launch.workspaceRoot, temporary, runtimeDirectory, privateDirectory),
            launch.command,
            ...launch.args,
          ],
      {
        cwd: launch.workspaceRoot,
        detached: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: `${runtimeDirectory}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`,
          HOME: home,
          TMPDIR: temporary,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          ...launch.environment,
        },
      },
    );
    let stopped = false;
    let closeTask: Promise<void> | undefined;
    let queue = Promise.resolve();
    let queuedBytes = 0;
    let stderr = Buffer.alloc(0);
    let truncated = false;
    const stdoutBudget = new ByteBudget(4 * 1024 * 1024, 8 * 1024 * 1024, 64 * 1024 * 1024);
    const stderrBudget = new ByteBudget(256 * 1024, 512 * 1024, 4 * 1024 * 1024);
    let resolveClosed: () => void = () => {};
    let rejectClosed: (reason: unknown) => void = () => {};
    const closed = new Promise<void>((accept, reject) => {
      resolveClosed = accept;
      rejectClosed = reject;
    });
    // The close operation owns rejection; this observer prevents a process fault becoming unhandled before its owner awaits it.
    closed.catch(() => {});
    const pipesClosed = new Promise<void>((accept) => {
      child.once('close', () => {
        accept();
      });
    });
    const close = (): Promise<void> => {
      stopped = true;
      if (closeTask) return closeTask;
      closeTask = (async () => {
        signal.removeEventListener('abort', abort);
        const failures: unknown[] = [];
        try {
          await stopOwnedProcessGroup(child, 2000, 5000);
        } catch (error) {
          failures.push(error);
        }
        try {
          await waitForProcessClose(pipesClosed, 5000);
        } catch (error) {
          failures.push(error);
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          try {
            await waitForProcessClose(pipesClosed, 500);
          } catch (last) {
            failures.push(last);
          }
        }
        try {
          await waitForProcessClose(queue, 5000);
        } catch (error) {
          failures.push(error);
        }
        try {
          await rm(temporary, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
        if (failures.length > 0) {
          const error = new ExecutionError(
            'PROCESS_CLEANUP_FAILED',
            'The owned local tool could not be fully cleaned up',
            { cause: new AggregateError(failures) },
          );
          rejectClosed(error);
          throw error;
        }
        resolveClosed();
      })();
      return closeTask;
    };
    const fail = (code: string, message: string): void => {
      if (stopped) return;
      stopped = true;
      observer.fault(new ExecutionError(code, message));
      close().catch((error: unknown) => {
        observer.fault(
          error instanceof ExecutionError
            ? error
            : new ExecutionError('PROCESS_CLEANUP_FAILED', 'Local tool cleanup failed'),
        );
      });
    };
    const abort = (): void => {
      fail('CANCELLED', 'Local tool connection was cancelled');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (!stdoutBudget.accept(chunk.length)) {
        fail('OUTPUT_LIMIT', 'Local tool stdout exceeded its resource limit');
        return;
      }
      try {
        observer.stdout(chunk);
      } catch {
        fail('INVALID_PROTOCOL', 'Local tool stdout is not valid MCP');
      }
    });
    child.stdout.once('end', () => {
      observer.stdoutEnd();
    });
    child.stdout.on('error', () => {
      fail('PROCESS_PIPE_FAILED', 'Local tool stdout could not be read');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (!stderrBudget.accept(chunk.length)) {
        fail('OUTPUT_LIMIT', 'Local tool stderr exceeded its resource limit');
        return;
      }
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > STDERR_RING_BYTES) {
        stderr = stderr.subarray(stderr.length - STDERR_RING_BYTES);
        truncated = true;
      }
    });
    child.stderr.on('error', () => {
      fail('PROCESS_PIPE_FAILED', 'Local tool stderr could not be read');
    });
    child.stdin.on('error', () => {
      fail('PROCESS_PIPE_FAILED', 'Local tool stdin closed unexpectedly');
    });
    child.once('error', () => {
      fail('PROCESS_START_FAILED', 'Local tool program could not start');
    });
    child.once('exit', () => {
      fail('PROCESS_EXITED', 'Local tool program exited');
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    owned = {
      closed,
      close,
      diagnostics: () => {
        let text = stderr.toString('utf8');
        const longest = Math.max(0, ...secrets.map((secret) => secret.length));
        if (truncated) text = text.slice(longest);
        for (const secret of secrets) {
          if (secret.length > 0) text = text.split(secret).join('[redacted]');
        }
        // A still-running child can end the current chunk with a secret prefix.
        for (const secret of secrets)
          for (let size = 1; size < secret.length; size += 1) {
            if (text.endsWith(secret.slice(0, size))) text = text.slice(0, -size) + '[redacted]';
          }
        return text;
      },
      write: async (bytes, options) => {
        if (stopped || options.signal.aborted)
          throw new ExecutionError('CANCELLED', 'Local tool write was cancelled before dispatch');
        if (queuedBytes + bytes.byteLength > MAX_WRITE_BYTES)
          throw new ExecutionError('WRITE_LIMIT', 'Local tool write queue is full');
        queuedBytes += bytes.byteLength;
        const operation = queue.then(async () => {
          if (stopped || options.signal.aborted)
            throw new ExecutionError('CANCELLED', 'Local tool write was cancelled before dispatch');
          options.beforeWrite?.();
          await new Promise<void>((accept, reject) => {
            child.stdin.write(bytes, (error) => {
              if (error)
                reject(
                  new ExecutionError(
                    'PROCESS_PIPE_FAILED',
                    'Local tool request could not be written',
                  ),
                );
              else accept();
            });
          });
        });
        queue = operation.catch(() => {});
        try {
          await operation;
        } finally {
          queuedBytes -= bytes.byteLength;
        }
      },
    };
    return owned;
  } catch (error) {
    if (owned) await owned.close();
    else await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
