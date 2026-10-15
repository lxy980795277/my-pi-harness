import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DaemonReadyRecordSchema,
  HealthResponseSchema,
  RuntimeReadyEventSchema,
  type DaemonReadyRecord,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { readSseRecord } from './support/sse.js';

interface ExitOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ManagedDaemon {
  child: ChildProcess;
  exited: Promise<ExitOutcome>;
  stdoutRecords: string[];
  stdoutEnded: Promise<void>;
  diagnosticsEnded: Promise<void>;
  stdout(): string;
  diagnostics(): string;
}

const daemons: ManagedDaemon[] = [];
const profiles: string[] = [];
const CLI_PATH = fileURLToPath(new URL('../dist/bootstrap.js', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('..', import.meta.url));

async function withDeadline<T>(
  operation: Promise<T>,
  message: string,
  durationMs = 10_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), durationMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function sendControl(
  child: ChildProcess,
  message: Readonly<Record<string, unknown>>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.send(message, (error: Error | null) => {
      if (error !== null) reject(error);
      else resolve();
    });
  });
}

function spawnDaemon(
  environmentOverrides: Readonly<Record<string, string>> = {},
): ManagedDaemon & { readiness: Promise<DaemonReadyRecord> } {
  const profile = mkdtempSync(join(tmpdir(), 'my-pi-cli-'));
  profiles.push(profile);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
    MY_PI_HARNESS_PARENT_PID: String(process.pid),
    ...environmentOverrides,
  };
  delete environment.MY_PI_HARNESS_WEB_DIST_PATH;
  delete environment.NODE_OPTIONS;
  const child = spawn(process.execPath, [CLI_PATH], {
    cwd: PACKAGE_PATH,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  if (child.stdout === null || child.stderr === null)
    throw new Error('Daemon has no diagnostic pipes');
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  child.stdout.on('data', (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-16_384);
  });
  const stdoutEnded = new Promise<void>((resolve) => {
    child.stdout?.once('end', resolve);
  });
  const diagnosticsEnded = new Promise<void>((resolve) => {
    child.stderr?.once('end', resolve);
  });
  let stderr = '';
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  const stdoutRecords: string[] = [];
  const exited = new Promise<ExitOutcome>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const managed = {
    child,
    exited,
    stdoutRecords,
    stdoutEnded,
    diagnosticsEnded,
    stdout: (): string => stdout,
    diagnostics: (): string => stderr,
  };
  daemons.push(managed);
  const readiness = new Promise<DaemonReadyRecord>((resolve, reject) => {
    let pending = '';
    child.stdout?.on('data', (chunk: string) => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const record = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        stdoutRecords.push(record);
        try {
          const value: unknown = JSON.parse(record);
          if (!Value.Check(DaemonReadyRecordSchema, value))
            throw new Error('Invalid daemon ready record');
          resolve(value);
        } catch (error: unknown) {
          reject(
            error instanceof Error
              ? error
              : new Error('Invalid daemon ready record', { cause: error }),
          );
        }
        newline = pending.indexOf('\n');
      }
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      reject(new Error(`Daemon exited before readiness (${code}/${signal}): ${stderr}`));
    });
  });
  return { ...managed, readiness };
}

async function startDaemon(): Promise<
  ManagedDaemon & { ready: DaemonReadyRecord; origin: string }
> {
  const managed = spawnDaemon();
  const ready = await withDeadline(managed.readiness, 'Daemon did not publish readiness');
  return { ...managed, ready, origin: `http://${ready.host}:${ready.port}` };
}

function observeLog(child: ChildProcess, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderr = child.stderr;
    if (stderr === null) {
      reject(new Error('Daemon has no diagnostic pipe'));
      return;
    }
    let pending = '';
    const cleanup = (): void => {
      stderr.off('data', receive);
      child.off('exit', closed);
    };
    const closed = (): void => {
      cleanup();
      reject(new Error('Daemon exited before its diagnostic was observed'));
    };
    const receive = (chunk: string): void => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          // This observer may join stderr midway through an earlier diagnostic record.
        }
        if (
          typeof entry === 'object' &&
          entry !== null &&
          'msg' in entry &&
          entry.msg === message
        ) {
          cleanup();
          resolve();
          return;
        }
        newline = pending.indexOf('\n');
      }
    };
    stderr.on('data', receive);
    child.once('exit', closed);
  });
}

afterEach(async () => {
  await Promise.all(
    daemons.splice(0).map(async ({ child, exited }) => {
      try {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (child.connected) {
          try {
            await sendControl(child, { type: 'daemon.shutdown' });
          } catch {
            // A daemon that has already disconnected will be reclaimed by the exit deadline.
          }
        }
        try {
          await withDeadline(exited, 'Daemon did not exit during cleanup', 2_000);
        } catch {
          child.kill('SIGKILL');
          await withDeadline(exited, 'Daemon could not be reclaimed', 5_000);
        }
      } finally {
        if (child.connected) child.disconnect();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    }),
  );
  for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true });
});

describe('built daemon owner channel', () => {
  it('rejects an unprobeable parent PID before publishing readiness', async () => {
    const daemon = spawnDaemon({ MY_PI_HARNESS_PARENT_PID: '2147483648' });
    await expect(
      withDeadline(daemon.readiness, 'Invalid parent PID did not fail startup'),
    ).rejects.toThrow('Daemon exited before readiness');
    expect(
      await withDeadline(daemon.exited, 'Invalid configuration did not end the daemon'),
    ).toEqual({
      code: 1,
      signal: null,
    });
    await withDeadline(
      Promise.all([daemon.stdoutEnded, daemon.diagnosticsEnded]),
      'Startup output did not close',
    );
    expect(daemon.stdout()).toBe('');
    expect(daemon.diagnostics()).toContain('Daemon failed to start');
    expect(daemon.diagnostics()).toContain('DaemonConfigError');
  });

  it('keeps running after invalid control input, then ends SSE and exits normally on shutdown', async () => {
    const daemon = await startDaemon();
    const rejected = observeLog(daemon.child, 'Ignored invalid daemon control message');
    await sendControl(daemon.child, { type: 'daemon.shutdown', unexpected: true });
    await withDeadline(rejected, 'Daemon did not reject invalid control input');
    const response = await fetch(`${daemon.origin}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const health: unknown = await response.json();
    expect(Value.Check(HealthResponseSchema, health)).toBe(true);
    if (!Value.Check(HealthResponseSchema, health)) throw new Error('Invalid health response');
    expect(health.instanceId).toBe(daemon.ready.instanceId);

    const events = await fetch(`${daemon.origin}/api/runtime/events`, {
      signal: AbortSignal.timeout(10_000),
    });
    const reader = events.body?.getReader();
    if (reader === undefined) throw new Error('SSE response has no body');
    const firstRecord = await readSseRecord(reader);
    expect(firstRecord).toContain('event: runtime.ready\n');
    const data = firstRecord.split('\n').find((line) => line.startsWith('data: '));
    if (data === undefined) throw new Error('SSE response has no ready record');
    const event: unknown = JSON.parse(data.slice(6));
    expect(Value.Check(RuntimeReadyEventSchema, event)).toBe(true);
    expect(event).toMatchObject({ instanceId: health.instanceId, startedAt: health.startedAt });

    const streamEnd = reader.read().then(
      (result) => ({ type: 'ended' as const, done: result.done }),
      (error: unknown) => ({ type: 'failed' as const, error }),
    );
    await sendControl(daemon.child, { type: 'daemon.shutdown' });
    expect(await withDeadline(streamEnd, 'Shutdown did not end SSE')).toEqual({
      type: 'ended',
      done: true,
    });
    expect(await withDeadline(daemon.exited, 'Shutdown did not end the daemon')).toEqual({
      code: 0,
      signal: null,
    });
    expect(daemon.stdoutRecords).toHaveLength(1);
  });

  it('exits normally when its owner disconnects IPC while the parent process remains alive', async () => {
    const daemon = await startDaemon();
    const stopped = observeLog(daemon.child, 'Stopping daemon');
    daemon.child.disconnect();
    await withDeadline(stopped, 'Owner disconnection did not start daemon shutdown');
    const outcome = await withDeadline(
      daemon.exited,
      'Owner disconnection did not end the daemon',
    ).catch((error: unknown) => {
      throw new Error(
        `Owner disconnection did not end the daemon (exit=${daemon.child.exitCode}, signal=${daemon.child.signalCode}): ${daemon.diagnostics()}`,
        { cause: error },
      );
    });
    expect(outcome).toEqual({ code: 0, signal: null });
  });
});
