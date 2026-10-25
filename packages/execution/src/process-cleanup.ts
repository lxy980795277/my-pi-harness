import { execFile, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionError } from './errors.js';

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

export async function stopOwnedProcessGroup(
  child: ChildProcess,
  termWaitMs = 300,
  killWaitMs = 1500,
): Promise<void> {
  const group = child.pid;
  if (group === undefined) return;
  try {
    signalGroup(group, 'SIGTERM');
    const graceful = performance.now() + termWaitMs;
    while (await groupAlive(group)) {
      if (performance.now() >= graceful) break;
      await delay(20);
    }
    if (await groupAlive(group)) signalGroup(group, 'SIGKILL');
    const deadline = performance.now() + killWaitMs;
    while (await groupAlive(group)) {
      if (performance.now() >= deadline)
        throw new ExecutionError('PROCESS_CLEANUP_FAILED', 'The owned process group did not stop');
      await delay(20);
    }
  } catch (cause) {
    // Inspection failure cannot justify leaving an owned command running.
    signalGroup(group, 'SIGKILL');
    throw cause;
  }
}

export async function waitForProcessClose(closed: Promise<void>, timeout: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<never>((_accept, reject) => {
        timer = setTimeout(() => {
          reject(
            new ExecutionError(
              'PROCESS_CLEANUP_FAILED',
              'Owned process pipes did not close before the cleanup deadline',
            ),
          );
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
