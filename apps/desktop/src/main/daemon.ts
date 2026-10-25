import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DaemonReadyRecordSchema,
  type DaemonReadyRecord,
  type DaemonControlMessage,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { app } from 'electron';
import { createDesktopAuthorization } from './authorization.js';
import { resolveProfileDirectory, resolveSessionLogRoot } from './profile-directory.js';

/** 桌面只监督自己启动的独立 Node 服务，不 import 服务业务源码。 */
export interface ManagedDaemon {
  origin: string;
  stop(): Promise<void>;
  authorizeRenderer(origin: string): Promise<void>;
  openAuth(flowId: string): Promise<void>;
  revealSkillDirectory(skillId: string, workspaceId: string | null): Promise<void>;
}

/** Cancellation owned by the desktop lifetime, including pending readiness. */
export interface DaemonStartOptions {
  signal?: AbortSignal;
}

async function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((accept) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      accept(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    child.once('exit', onExit);
  });
}

/**
 * 以发布资源或开发源码启动独立 Node，并在失败或取消后等待子进程退出。
 * @param options 桌面关闭时中止尚未完成的启动。
 * @returns 已就绪服务的地址和幂等关闭操作。
 */
export async function startDaemon({ signal }: DaemonStartOptions = {}): Promise<ManagedDaemon> {
  signal?.throwIfAborted();
  const ownerSecret = randomBytes(32).toString('base64url');
  const resources = process.resourcesPath;
  const nodePath = app.isPackaged
    ? resolve(resources, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
    : (process.env['MY_PI_HARNESS_NODE_PATH'] ?? 'node');
  const entry = app.isPackaged
    ? resolve(resources, 'daemon', 'dist', 'bootstrap.js')
    : fileURLToPath(new URL('../../../daemon/src/bootstrap.ts', import.meta.url));
  const args = app.isPackaged
    ? [`--env-file=${resolve(resources, 'daemon', 'desktop-oauth.env')}`, entry]
    : [
        `--env-file-if-exists=${fileURLToPath(new URL('../../../../.env', import.meta.url))}`,
        '--import',
        'tsx',
        entry,
      ];
  const cwd = app.isPackaged
    ? resolve(resources, 'daemon')
    : fileURLToPath(new URL('../../../daemon', import.meta.url));
  const configuredLogRoot = process.env['MY_PI_HARNESS_SESSION_LOG_ROOT'];
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    MY_PI_HARNESS_PORT: app.isPackaged ? '0' : '4311',
    MY_PI_HARNESS_PARENT_PID: String(process.pid),
    MY_PI_HARNESS_DESKTOP_SECRET: ownerSecret,
    MY_PI_HARNESS_PROFILE_DIRECTORY: resolveProfileDirectory({
      platform: process.platform,
      userData: app.getPath('userData'),
      home: app.getPath('home'),
      ...(process.env['LOCALAPPDATA'] ? { localAppData: process.env['LOCALAPPDATA'] } : {}),
    }),
    MY_PI_HARNESS_SESSION_LOG_ROOT: resolveSessionLogRoot({
      packaged: app.isPackaged,
      developmentRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
      ...(configuredLogRoot === undefined ? {} : { configuredRoot: configuredLogRoot }),
    }),
    ...(app.isPackaged ? { MY_PI_HARNESS_WEB_DIST_PATH: resolve(resources, 'web') } : {}),
  };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === 'MY_PI_HARNESS_DEVELOPMENT_ORIGIN') delete environment[key];
  }
  if (!app.isPackaged) environment['MY_PI_HARNESS_DEVELOPMENT_ORIGIN'] = 'http://127.0.0.1:5174';
  const child = spawn(nodePath, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: environment,
  });
  let stopping: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) {
      child.send({ type: 'daemon.shutdown' } satisfies DaemonControlMessage, (error) => {
        if (error && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      });
    } else {
      child.kill('SIGTERM');
    }
    if (!(await waitForExit(child, 20_000))) {
      child.kill('SIGKILL');
      if (!(await waitForExit(child, 2_000))) throw new Error('本机服务未能退出');
    }
  };
  const stop = () => (stopping ??= close());
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  child.on('error', (error) => {
    process.stderr.write(`本机服务进程错误：${error.message}\n`);
  });
  child.stdout?.setEncoding('utf8');
  try {
    const record = await new Promise<DaemonReadyRecord>((accept, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => finish(new Error('本机服务启动超时')), 15_000);
      const finish = (error?: Error, value?: DaemonReadyRecord) => {
        clearTimeout(timeout);
        child.stdout?.removeListener('data', receive);
        child.removeListener('error', failed);
        child.removeListener('exit', exited);
        signal?.removeEventListener('abort', aborted);
        if (error) reject(error);
        else if (value) accept(value);
      };
      const failed = (error: Error) => finish(error);
      const exited = () => finish(new Error('本机服务在就绪前退出'));
      const aborted = () => {
        try {
          signal?.throwIfAborted();
        } catch (error: unknown) {
          finish(
            error instanceof Error ? error : new Error('本机服务启动已取消', { cause: error }),
          );
        }
      };
      const receive = (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 64 * 1024) {
          finish(new Error('本机服务启动记录过大'));
          return;
        }
        const end = buffer.indexOf('\n');
        if (end === -1) return;
        try {
          const value: unknown = JSON.parse(buffer.slice(0, end));
          if (!Value.Check(DaemonReadyRecordSchema, value)) throw new Error('本机服务启动记录无效');
          finish(undefined, value);
        } catch {
          finish(new Error('本机服务启动记录无效'));
        }
      };
      child.once('error', failed);
      child.once('exit', exited);
      child.stdout?.on('data', receive);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
    const origin = `http://${record.host}:${record.port}`;
    return {
      origin,
      stop,
      ...createDesktopAuthorization(origin, ownerSecret, signal),
    };
  } catch (error: unknown) {
    await stop();
    throw error;
  }
}
