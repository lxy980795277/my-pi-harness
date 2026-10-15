import { execFile, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionError } from './errors.js';

const MAXIMUM_OUTPUT_BYTES = 100_000;
const CLOSE_WAIT_MS = 2_000;

interface ShellExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

async function groupAlive(group: number): Promise<boolean> {
  const statuses = await new Promise<string>((accept, reject) => {
    execFile(
      '/bin/ps',
      ['-A', '-o', 'pgid=,stat='],
      { timeout: 1000, maxBuffer: 2_000_000 },
      (error, stdout) => {
        if (error)
          reject(
            new ExecutionError(
              'PROCESS_INSPECTION_FAILED',
              'Could not inspect the owned process group',
              { cause: error },
            ),
          );
        else accept(stdout);
      },
    );
  });
  return statuses.split('\n').some((line) => {
    const [id, state] = line.trim().split(/\s+/);
    return Number(id) === group && state !== undefined && !state.startsWith('Z');
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  const group = child.pid;
  if (group === undefined) return;
  try {
    signalGroup(group, 'SIGTERM');
    const graceful = performance.now() + 300;
    while (await groupAlive(group)) {
      if (performance.now() >= graceful) break;
      await delay(20);
    }
    if (await groupAlive(group)) signalGroup(group, 'SIGKILL');
    const deadline = performance.now() + 1500;
    while (await groupAlive(group)) {
      if (performance.now() >= deadline)
        throw new ExecutionError(
          'PROCESS_CLEANUP_FAILED',
          'The owned shell process group did not stop',
        );
      await delay(20);
    }
  } catch (cause) {
    // Inspection failure cannot justify leaving an owned command running.
    signalGroup(group, 'SIGKILL');
    throw cause;
  }
}

async function waitForClose(closed: Promise<void>, timeout: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<never>((_accept, reject) => {
        timer = setTimeout(() => {
          reject(
            new ExecutionError(
              'PROCESS_CLEANUP_FAILED',
              'Shell output pipes did not close before the cleanup deadline',
            ),
          );
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Leader exit starts cleanup; only closed output pipes permit a successful result. */
export async function collectShellProcess(
  child: ChildProcess,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ShellExit & { output: string }> {
  let output = '';
  let bytes = 0;
  let failure: ExecutionError | undefined;
  let fail = (_error: ExecutionError): void => {};
  const failed = new Promise<never>((_accept, reject) => {
    fail = (error) => {
      failure ??= error;
      reject(failure);
    };
  });
  const receive = (decoder: StringDecoder, chunk: Buffer): void => {
    bytes += chunk.length;
    if (bytes > MAXIMUM_OUTPUT_BYTES) {
      fail(new ExecutionError('OUTPUT_LIMIT', 'Shell output exceeded 100000 bytes'));
      return;
    }
    output += decoder.write(chunk);
  };
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const decoder = new StringDecoder('utf8');
    stream.on('data', (chunk: Buffer) => {
      receive(decoder, chunk);
    });
    stream.on('end', () => {
      output += decoder.end();
    });
    stream.on('error', (cause) => {
      fail(
        new ExecutionError('SHELL_OUTPUT_FAILED', 'Shell output could not be read completely', {
          cause,
        }),
      );
    });
  }
  const exited = new Promise<ShellExit>((accept) => {
    child.on('exit', (code, exitSignal) => {
      accept({ code, signal: exitSignal });
    });
    child.on('error', (cause) => {
      fail(
        new ExecutionError('SHELL_START_FAILED', 'The shell process could not start', { cause }),
      );
    });
  });
  const closed = new Promise<void>((accept) => {
    child.once('close', () => {
      accept();
    });
  });
  const abort = (): void => {
    fail(new ExecutionError('CANCELLED', 'Shell execution was cancelled'));
  };
  const timer = setTimeout(() => {
    fail(new ExecutionError('TIMEOUT', 'Shell execution exceeded its time limit'));
  }, timeoutMs);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let exit: ShellExit | undefined;
  let executionFailure: Error | undefined;
  const cleanupFailures: unknown[] = [];
  try {
    try {
      exit = await Promise.race([exited, failed]);
    } catch (cause) {
      executionFailure =
        cause instanceof Error
          ? cause
          : new ExecutionError('SHELL_FAILED', 'Shell execution did not settle', { cause });
    }
    try {
      await stopGroup(child);
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    try {
      await waitForClose(closed, CLOSE_WAIT_MS);
    } catch (cause) {
      cleanupFailures.push(cause);
      child.stdout?.destroy();
      child.stderr?.destroy();
      try {
        await waitForClose(closed, 500);
      } catch (closeCause) {
        cleanupFailures.push(closeCause);
      }
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
  if (cleanupFailures.length > 0)
    throw new ExecutionError(
      'PROCESS_CLEANUP_FAILED',
      'Shell execution could not be completely cleaned up',
      {
        cause: new AggregateError([
          ...(executionFailure === undefined ? [] : [executionFailure]),
          ...cleanupFailures,
        ]),
      },
    );
  if (failure) throw failure;
  if (executionFailure !== undefined) throw executionFailure;
  if (!exit) throw new ExecutionError('SHELL_FAILED', 'The shell did not report its exit');
  return { ...exit, output };
}
