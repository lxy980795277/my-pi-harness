import { execFile, spawn } from 'node:child_process';
import { dirname, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const TERM_GRACE_MS = 2_000;
const KILL_WAIT_MS = 2_000;
const COMMAND_WAIT_MS = 5_000;
const POLL_INTERVAL_MS = 25;

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null || child.pid === undefined;
}

async function waitUntil(check, timeout) {
  const deadline = performance.now() + timeout;
  while (true) {
    if (await check()) return true;
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    // A referenced timer keeps cleanup alive after the group leader exits.
    await delay(Math.min(POLL_INTERVAL_MS, remaining));
  }
}

function signalGroup(group, signal) {
  try {
    process.kill(-group, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    if (signal === 0 && error instanceof Error && 'code' in error && error.code === 'EPERM') {
      // A permission-denied probe still permits checking whether the group has live members.
      return true;
    }
    throw error;
  }
}

async function hasLiveGroup(group) {
  if (!signalGroup(group, 0)) return false;
  const statuses = await new Promise((accept, reject) => {
    execFile(
      '/bin/ps',
      ['-A', '-o', 'pgid=,stat='],
      { timeout: 1_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) reject(error);
        else accept(stdout);
      },
    );
  });
  // Zombies have already terminated; their adopted parent owns reaping them.
  return statuses.split('\n').some((line) => {
    const [id, status] = line.trim().split(/\s+/);
    return Number(id) === group && status !== undefined && !status.startsWith('Z');
  });
}

async function stopUnixGroup(child, group, gracePeriodMs) {
  if (await hasLiveGroup(group)) {
    if (
      signalGroup(group, 'SIGTERM') &&
      !(await waitUntil(async () => !(await hasLiveGroup(group)), gracePeriodMs))
    ) {
      signalGroup(group, 'SIGKILL');
      if (!(await waitUntil(async () => !(await hasLiveGroup(group)), KILL_WAIT_MS))) {
        throw new Error(`Development process group ${group} did not terminate`);
      }
    }
  }
  if (!(await waitUntil(() => hasExited(child), KILL_WAIT_MS))) {
    throw new Error('Development group leader did not report its exit');
  }
}

async function runTaskkill(pid) {
  const command = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    shell: false,
  });
  let failure;
  command.on('error', (error) => {
    failure = error;
  });
  if (
    !(await waitUntil(
      () => failure !== undefined || command.exitCode !== null || command.signalCode !== null,
      COMMAND_WAIT_MS,
    ))
  ) {
    command.kill('SIGKILL');
    await waitUntil(() => hasExited(command), KILL_WAIT_MS);
    throw new Error('taskkill did not finish before its deadline', { cause: failure });
  }
  if (failure !== undefined) throw failure;
  if (command.exitCode !== 0)
    throw new Error(`taskkill failed (${command.exitCode ?? command.signalCode})`);
}

async function stopWindowsTree(child) {
  // taskkill cannot recover descendants once their original parent PID is gone.
  if (hasExited(child)) return;
  let failure;
  try {
    await runTaskkill(child.pid);
  } catch (error) {
    failure = error;
    child.kill('SIGKILL');
  }
  if (!(await waitUntil(() => hasExited(child), KILL_WAIT_MS))) {
    throw new Error('Development child did not report its exit', { cause: failure });
  }
  if (failure !== undefined) throw failure;
}

/**
 * Spawn one owned development command; stop waits for its reachable process tree.
 * POSIX descendants must inherit this command's detached process group. Windows
 * uses taskkill while its leader exists; it does not provide Job Object ownership.
 * Repeated stop calls never signal a previously completed PID or process group.
 * @param command Executable selected by the development launcher.
 * @param args Argument vector passed without a shell.
 * @param options Spawn settings and optional POSIX gracePeriodMs; shell and detached are owned by this helper.
 * @returns The actual child and a shared, bounded cleanup operation.
 */
export function spawnOwnedProcess(command, args, options = {}) {
  const { gracePeriodMs = TERM_GRACE_MS, ...spawnOptions } = options;
  if (!Number.isInteger(gracePeriodMs) || gracePeriodMs < 1 || gracePeriodMs > 30_000)
    throw new Error('Invalid development shutdown grace period');
  const child = spawn(command, args, {
    ...spawnOptions,
    detached: process.platform !== 'win32',
    shell: false,
  });
  const group = child.pid;
  let childError;
  let stopping;
  child.on('error', (error) => {
    childError = error;
  });
  const stop = () => {
    stopping ??= (async () => {
      if (group === undefined) return;
      try {
        if (process.platform === 'win32') await stopWindowsTree(child);
        else await stopUnixGroup(child, group, gracePeriodMs);
      } catch (error) {
        throw new AggregateError(
          childError === undefined ? [error] : [error, childError],
          'Failed to clean up an owned development process',
          { cause: error },
        );
      }
    })();
    return stopping;
  };
  return { child, stop };
}

/**
 * Prepend the controlled Node runtime without duplicate Windows PATH variants.
 * @param runtime Absolute Node executable used by development children.
 * @param environment Environment copied for this child only.
 * @param platform Target platform; defaults to the current host.
 * @returns A copied environment with exactly one Windows PATH key.
 */
export function withNodeRuntimePath(runtime, environment, platform = process.platform) {
  const env = { ...environment };
  const keys = Object.keys(env).filter((key) => key.toUpperCase() === 'PATH');
  const selected = platform === 'win32' ? keys.sort()[0] : 'PATH';
  const inherited = selected === undefined ? '' : (env[selected] ?? '');
  if (platform === 'win32') for (const key of keys) delete env[key];
  const directory = platform === 'win32' ? win32.dirname(runtime) : dirname(runtime);
  env['PATH'] = `${directory}${platform === 'win32' ? ';' : ':'}${inherited}`;
  return env;
}
