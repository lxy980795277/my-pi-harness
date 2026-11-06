import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { constants as osConstants, homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { SandboxError, checkCancelled } from '../errors';
import { sandboxProfile } from '../platform/macos';
import { ByteBudget, redactProcessDiagnostics } from './budget';
import { stopOwnedProcessGroup, waitForProcessClose } from './cleanup';
import { resolveProcess } from './resolve';
import { WATCHDOG_SOURCE } from './watchdog';
import type { ManagedProcess, ProcessExit, ProcessLaunch, ProcessObserver } from './types';

type WatchdogMessage =
  | { type: 'started'; pid: number }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'fault'; code: string };

function decodeWatchdogMessage(line: string): WatchdogMessage {
  const value: unknown = JSON.parse(line);
  if (typeof value === 'object' && value !== null && 'type' in value) {
    if (
      value.type === 'started' &&
      'pid' in value &&
      typeof value.pid === 'number' &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 0
    )
      return { type: 'started', pid: value.pid };
    if (value.type === 'fault' && 'code' in value && typeof value.code === 'string')
      return { type: 'fault', code: value.code };
    if (
      value.type === 'exit' &&
      'code' in value &&
      'signal' in value &&
      (value.code === null || (typeof value.code === 'number' && Number.isInteger(value.code))) &&
      (value.signal === null ||
        (typeof value.signal === 'string' && Object.hasOwn(osConstants.signals, value.signal)))
    )
      return { type: 'exit', code: value.code, signal: value.signal as NodeJS.Signals | null };
  }
  throw new SandboxError(
    'PROCESS_WATCHDOG_FAILED',
    'The process watchdog sent an invalid response',
  );
}

/** Start a bounded duplex process without exposing native process or stream handles. */
export async function startProcess(
  launch: ProcessLaunch,
  observer: ProcessObserver,
  signal: AbortSignal,
  secrets: readonly string[] = [],
): Promise<ManagedProcess> {
  checkCancelled(signal);
  const current = await resolveProcess(launch);
  if (
    JSON.stringify(current.programIdentity) !== JSON.stringify(launch.programIdentity) ||
    JSON.stringify(current.argumentIdentities) !== JSON.stringify(launch.argumentIdentities) ||
    JSON.stringify(current.workspaceIdentity) !== JSON.stringify(launch.workspaceIdentity) ||
    JSON.stringify(current.resourceIdentities) !== JSON.stringify(launch.resourceIdentities) ||
    current.command !== launch.command ||
    current.resolvedCommand !== launch.resolvedCommand ||
    current.profileDirectory !== launch.profileDirectory
  )
    throw new SandboxError(
      'PROGRAM_CHANGED',
      'The program or read-only resources changed after authorization',
    );
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-process-')));
  let owned: ManagedProcess | undefined;
  let spawned: ChildProcess | undefined;
  try {
    const runtimeDirectory = dirname(await realpath(process.execPath));
    const full = launch.access === 'full-access';
    const home = full ? await realpath(homedir()) : temporary;
    const environment = {
      PATH: `${runtimeDirectory}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`,
      HOME: home,
      TMPDIR: temporary,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      PYTHONPYCACHEPREFIX: temporary,
      ...launch.environment,
    };
    checkCancelled(signal);
    const command = full ? launch.command : '/usr/bin/sandbox-exec';
    const args = full
      ? [...launch.args]
      : [
          '-p',
          sandboxProfile({
            workspaceRoot: launch.workspaceRoot,
            temporaryDirectory: temporary,
            runtimeDirectories: [runtimeDirectory],
            programPaths: [launch.command, launch.resolvedCommand],
            profileDirectory: launch.profileDirectory,
            readOnlyDirectories: launch.readOnlyDirectories,
            access: launch.access === 'read-only' ? 'read-only' : 'workspace-write',
          }),
          launch.command,
          ...launch.args,
        ];
    const child = spawn(process.execPath, ['--input-type=module', '-e', WATCHDOG_SOURCE], {
      cwd: temporary,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });
    spawned = child;
    // These slots are private daemon-to-watchdog control pipes, fixed by the stdio tuple above.
    const control = child.stdio[3] as Writable;
    const status = child.stdio[4] as Readable;
    if (!child.stdin || !child.stdout || !child.stderr || !control || !status)
      throw new SandboxError('PROCESS_START_FAILED', 'Could not create owned process pipes');
    const input = child.stdin;
    const output = child.stdout;
    const errors = child.stderr;
    let stopped = false;
    let closeTask: Promise<void> | undefined;
    let queue = Promise.resolve();
    let queuedBytes = 0;
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let result: ProcessExit | undefined;
    let targetPid: number | undefined;
    let watchdogFailure: SandboxError | undefined;
    let lifetime: NodeJS.Timeout | undefined;
    let resolveExit: (value: ProcessExit) => void = () => {};
    let rejectExit: (error: unknown) => void = () => {};
    const exit = new Promise<ProcessExit>((accept, reject) => {
      resolveExit = accept;
      rejectExit = reject;
    });
    exit.catch(() => {});
    let resolveClosed: () => void = () => {};
    let rejectClosed: (error: unknown) => void = () => {};
    const closed = new Promise<void>((accept, reject) => {
      resolveClosed = accept;
      rejectClosed = reject;
    });
    closed.catch(() => {});
    const pipesClosed = new Promise<void>((accept) => {
      child.once('close', accept);
    });
    const stdoutBudget = new ByteBudget(
      launch.limits.stdoutBytesPerSecond,
      launch.limits.stdoutBurstBytes,
      launch.limits.stdoutBytes,
    );
    const stderrBudget = new ByteBudget(
      launch.limits.stderrBytesPerSecond,
      launch.limits.stderrBurstBytes,
      launch.limits.stderrBytes,
    );
    const notifyFault = (error: SandboxError): void => {
      try {
        observer.fault(error);
      } catch {
        /* Observer failures cannot prevent physical cleanup. */
      }
    };
    const close = (): Promise<void> => {
      stopped = true;
      if (closeTask) return closeTask;
      closeTask = (async () => {
        signal.removeEventListener('abort', abort);
        clearTimeout(lifetime);
        const failures: unknown[] = [];
        control.end();
        try {
          await waitForProcessClose(
            pipesClosed,
            launch.limits.terminateGraceMs +
              launch.limits.killWaitMs +
              launch.limits.pipeCloseMs +
              1000,
          );
        } catch (error) {
          failures.push(error);
        }
        // The independent supervisor normally finishes this first; retain a daemon-side fallback.
        if (targetPid !== undefined) {
          try {
            await stopOwnedProcessGroup(
              { pid: targetPid },
              launch.limits.terminateGraceMs,
              launch.limits.killWaitMs,
            );
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await stopOwnedProcessGroup(
            child,
            launch.limits.terminateGraceMs,
            launch.limits.killWaitMs,
          );
        } catch (error) {
          failures.push(error);
        }
        input.destroy();
        output.destroy();
        errors.destroy();
        control.destroy();
        status.destroy();
        try {
          await waitForProcessClose(pipesClosed, 500);
        } catch (last) {
          failures.push(last);
        }
        if (watchdogFailure) failures.push(watchdogFailure);
        try {
          await waitForProcessClose(queue, launch.limits.pipeCloseMs);
        } catch (error) {
          failures.push(error);
        }
        try {
          await rm(temporary, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
        if (!result) {
          const error = new SandboxError(
            'PROCESS_EXIT_UNKNOWN',
            'The owned program did not report its exit',
          );
          rejectExit(error);
        }
        if (failures.length > 0) {
          const error = new SandboxError(
            'PROCESS_CLEANUP_FAILED',
            'The owned process could not be fully cleaned up',
            { cause: new AggregateError(failures) },
          );
          rejectClosed(error);
          throw error;
        }
        resolveClosed();
      })();
      return closeTask;
    };
    const beginClose = (): void => {
      close().catch((cause: unknown) => {
        notifyFault(
          cause instanceof SandboxError
            ? cause
            : new SandboxError('PROCESS_CLEANUP_FAILED', 'Owned process cleanup failed', { cause }),
        );
      });
    };
    const fail = (code: string, message: string): void => {
      if (stopped) return;
      stopped = true;
      notifyFault(new SandboxError(code, message));
      beginClose();
    };
    const abort = (): void => {
      fail('CANCELLED', 'The owned process was cancelled');
    };
    output.on('data', (chunk: Buffer) => {
      if (!stdoutBudget.accept(chunk.length)) {
        fail('OUTPUT_LIMIT', 'Process stdout exceeded its resource limit');
        return;
      }
      try {
        observer.stdout(chunk);
      } catch {
        fail('PROCESS_OBSERVER_FAILED', 'The process output consumer failed');
      }
    });
    output.once('end', () => {
      try {
        observer.stdoutEnd();
      } catch {
        fail('PROCESS_OBSERVER_FAILED', 'The process output consumer failed');
      }
    });
    output.on('error', () => {
      fail('PROCESS_PIPE_FAILED', 'Process stdout could not be read');
    });
    errors.on('data', (chunk: Buffer) => {
      if (!stderrBudget.accept(chunk.length)) {
        fail('OUTPUT_LIMIT', 'Process stderr exceeded its resource limit');
        return;
      }
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > launch.limits.diagnosticBytes) {
        stderr = stderr.subarray(stderr.length - launch.limits.diagnosticBytes);
        truncated = true;
      }
      try {
        observer.stderr?.(chunk);
      } catch {
        fail('PROCESS_OBSERVER_FAILED', 'The process error consumer failed');
      }
    });
    errors.once('end', () => {
      try {
        observer.stderrEnd?.();
      } catch {
        fail('PROCESS_OBSERVER_FAILED', 'The process error consumer failed');
      }
    });
    errors.on('error', () => {
      fail('PROCESS_PIPE_FAILED', 'Process stderr could not be read');
    });
    input.on('error', () => {
      if (!result) fail('PROCESS_PIPE_FAILED', 'Process stdin closed unexpectedly');
    });
    control.on('error', () => {
      if (!result) fail('PROCESS_WATCHDOG_FAILED', 'The process watchdog control pipe failed');
    });
    let statusBuffer = '';
    status.on('data', (chunk: Buffer) => {
      statusBuffer += chunk.toString('utf8');
      if (statusBuffer.length > 16_384) {
        fail('PROCESS_WATCHDOG_FAILED', 'The process watchdog response exceeded its limit');
        return;
      }
      for (;;) {
        const end = statusBuffer.indexOf('\n');
        if (end < 0) break;
        const line = statusBuffer.slice(0, end);
        statusBuffer = statusBuffer.slice(end + 1);
        let message: WatchdogMessage;
        try {
          message = decodeWatchdogMessage(line);
        } catch {
          fail('PROCESS_WATCHDOG_FAILED', 'The process watchdog sent an invalid response');
          return;
        }
        if (message.type === 'exit') {
          result = { code: message.code, signal: message.signal };
          resolveExit(result);
          try {
            observer.exit?.(result);
          } catch {
            notifyFault(
              new SandboxError('PROCESS_OBSERVER_FAILED', 'The process exit consumer failed'),
            );
          }
          beginClose();
        } else if (message.type === 'fault') {
          if (message.code === 'PROCESS_CLEANUP_FAILED')
            watchdogFailure = new SandboxError(
              message.code,
              'The process watchdog could not confirm complete cleanup',
            );
          fail(
            message.code,
            message.code === 'PROCESS_START_FAILED'
              ? 'The owned program could not start'
              : 'The process watchdog reported a resource failure',
          );
        } else if (message.type === 'started') targetPid = message.pid;
        else fail('PROCESS_WATCHDOG_FAILED', 'The process watchdog sent an invalid response');
      }
    });
    status.on('error', () => {
      fail('PROCESS_WATCHDOG_FAILED', 'The process watchdog response pipe failed');
    });
    child.once('error', () => {
      fail('PROCESS_START_FAILED', 'The process watchdog could not start');
    });
    child.once('exit', () => {
      if (!result && !stopped)
        fail('PROCESS_WATCHDOG_FAILED', 'The process watchdog exited without a program result');
    });
    signal.addEventListener('abort', abort, { once: true });
    if (launch.limits.lifetimeMs !== undefined)
      lifetime = setTimeout(() => {
        fail('TIMEOUT', 'The owned process exceeded its time limit');
      }, launch.limits.lifetimeMs);
    owned = {
      closed,
      exit,
      close,
      diagnostics: () => redactProcessDiagnostics(stderr, truncated, secrets),
      write: async (bytes, options) => {
        if (stopped || options.signal.aborted)
          throw new SandboxError('CANCELLED', 'Process write was cancelled before dispatch');
        if (queuedBytes + bytes.byteLength > launch.limits.queuedWriteBytes)
          throw new SandboxError('WRITE_LIMIT', 'The process write queue is full');
        queuedBytes += bytes.byteLength;
        // Own the queued bytes so a caller cannot mutate a request after its dispatch check.
        const payload = Buffer.from(bytes);
        const operation = queue.then(async () => {
          if (stopped || options.signal.aborted)
            throw new SandboxError('CANCELLED', 'Process write was cancelled before dispatch');
          options.beforeWrite?.();
          if (stopped || options.signal.aborted)
            throw new SandboxError('CANCELLED', 'Process write was cancelled before dispatch');
          await new Promise<void>((accept, reject) => {
            input.write(payload, (cause) => {
              if (cause)
                reject(
                  new SandboxError('PROCESS_PIPE_FAILED', 'Process bytes could not be written', {
                    cause,
                  }),
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
    if (signal.aborted) abort();
    else
      control.write(
        JSON.stringify({
          command,
          args,
          cwd: launch.workspaceRoot,
          env: environment,
          temporaryDirectory: temporary,
          terminateGraceMs: launch.limits.terminateGraceMs,
          killWaitMs: launch.limits.killWaitMs,
          pipeCloseMs: launch.limits.pipeCloseMs,
        }) + '\n',
      );
    return owned;
  } catch (error) {
    if (owned) await owned.close();
    else {
      if (spawned) {
        await stopOwnedProcessGroup(spawned);
        for (const stream of spawned.stdio) stream?.destroy();
      }
      await rm(temporary, { recursive: true, force: true });
    }
    throw error;
  }
}
