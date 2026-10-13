import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DaemonReadyRecordSchema } from '@my-pi-harness/protocol';
import { test as base } from '@playwright/test';
import { Value } from 'typebox/value';

interface RunningDaemon {
  origin: string;
  stop: () => Promise<void>;
}

/** Starts built daemon exports and static Web with an isolated listener per test. */
export const test = base.extend<{ daemon: RunningDaemon }>({
  daemon: async ({}, use) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../../apps/daemon/dist/bootstrap.js', import.meta.url))],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          MY_PI_HARNESS_PORT: '0',
          MY_PI_HARNESS_PARENT_PID: String(process.pid),
          MY_PI_HARNESS_WEB_DIST_PATH: fileURLToPath(
            new URL('../../apps/web/dist', import.meta.url),
          ),
        },
      },
    );
    const { stdout, stderr: errorStream } = child;
    assert(stdout && errorStream, 'Daemon launch requires stdout and stderr pipes');
    let stderr = '';
    errorStream.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = once(child, 'exit');
    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> =>
      (stopPromise ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (child.connected) child.send({ type: 'daemon.shutdown' }, () => undefined);
        else child.kill('SIGTERM');
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5_000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      })());
    try {
      const origin = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        const timeout = setTimeout(
          () => fail(new Error(`Daemon readiness timed out: ${stderr}`)),
          10_000,
        );
        const cleanup = (): void => {
          clearTimeout(timeout);
          stdout.removeListener('data', receive);
          child.removeListener('error', fail);
          child.removeListener('exit', earlyExit);
        };
        const fail = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const earlyExit = (): void => fail(new Error(`Daemon exited before readiness: ${stderr}`));
        const receive = (chunk: Buffer): void => {
          buffer += chunk.toString();
          if (buffer.length > 64 * 1024) {
            fail(new Error('Oversized daemon ready record'));
            return;
          }
          const end = buffer.indexOf('\n');
          if (end === -1) return;
          try {
            const record: unknown = JSON.parse(buffer.slice(0, end));
            if (!Value.Check(DaemonReadyRecordSchema, record))
              throw new Error('Invalid daemon ready record');
            cleanup();
            resolve(`http://${record.host}:${record.port}`);
          } catch (error: unknown) {
            fail(error instanceof Error ? error : new Error('Invalid ready JSON'));
          }
        };
        stdout.on('data', receive);
        child.once('error', fail);
        child.once('exit', earlyExit);
      });
      await use({ origin, stop });
    } finally {
      await stop();
    }
  },
});

export { expect } from '@playwright/test';
