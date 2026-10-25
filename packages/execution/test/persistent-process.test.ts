import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolvePersistentProcess,
  startPersistentProcess,
  type PersistentProcess,
  type PersistentProcessInput,
} from '../src/index.js';

const roots: string[] = [];
const processes: PersistentProcess[] = [];
afterEach(async () => {
  await Promise.all(
    processes.splice(0).map(async (owned) => {
      await owned.close();
    }),
  );
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});
async function launch(
  code: string,
  scope: 'sandboxed' | 'full-access' = 'full-access',
  environment: Record<string, string> = {},
): Promise<PersistentProcessInput> {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'mcp-process-workspace-')));
  const profileDirectory = await realpath(await mkdtemp(join(tmpdir(), 'mcp-process-profile-')));
  roots.push(workspaceRoot, profileDirectory);
  return {
    command: process.execPath,
    args: ['-e', code],
    workspaceRoot,
    profileDirectory,
    environment,
    scope,
  };
}
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}
function lines(): { receive: (chunk: Buffer) => void; next: () => Promise<string> } {
  const pending: string[] = [];
  let buffer = '';
  let notify: ((line: string) => void) | undefined;
  return {
    receive: (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (notify) {
          const accept = notify;
          notify = undefined;
          accept(line);
        } else pending.push(line);
      }
    },
    next: async () => {
      const existing = pending.shift();
      if (existing !== undefined) return existing;
      return await new Promise<string>((accept) => {
        notify = accept;
      });
    },
  };
}

describe.skipIf(process.platform !== 'darwin')('owned duplex process lifecycle', () => {
  it.each([
    'PATH',
    'HOME',
    'NODE_OPTIONS',
    'NODE_PATH',
    'BASH_ENV',
    'DYLD_INSERT_LIBRARIES',
    'PYTHONSTARTUP',
  ])('rejects %s launch controls rather than inheriting or overriding the host', async (name) => {
    const input = await launch('setInterval(()=>{},1000)', 'full-access', { [name]: 'forbidden' });
    await expect(resolvePersistentProcess(input)).rejects.toHaveProperty(
      'code',
      'INVALID_ENVIRONMENT',
    );
  });
  it('uses an explicit environment, supports duplex bytes and waits for real close on repeated close', async () => {
    const messages = lines();
    const input = await launch(
      "process.stdout.write(String(process.pid)+'\\n');process.stdin.on('data',b=>process.stdout.write(b));process.stderr.write('fake-private-');process.stderr.write('secret');",
    );
    const owned = await startPersistentProcess(
      await resolvePersistentProcess(input),
      { stdout: messages.receive, stdoutEnd: () => {}, fault: () => {} },
      new AbortController().signal,
      ['fake-private-secret'],
    );
    processes.push(owned);
    const pid = Number(await messages.next());
    await owned.write(Buffer.from('hello\n'), { signal: new AbortController().signal });
    expect(await messages.next()).toBe('hello');
    await expect.poll(() => owned.diagnostics(), { timeout: 3000 }).toContain('[redacted]');
    expect(owned.diagnostics()).not.toContain('fake-private-secret');
    const first = owned.close();
    expect(owned.close()).toBe(first);
    await first;
    await owned.closed;
    expect(pidAlive(pid)).toBe(false);
  });
  it('rechecks cancellation after queued backpressure and never hands the second request to stdin', async () => {
    const messages = lines();
    const input = await launch(
      "process.stdout.write(String(process.pid)+'\\n');setInterval(()=>{},1000);",
    );
    const owned = await startPersistentProcess(
      await resolvePersistentProcess(input),
      { stdout: messages.receive, stdoutEnd: () => {}, fault: () => {} },
      new AbortController().signal,
    );
    processes.push(owned);
    await messages.next();
    let writes = 0;
    let entered: () => void = () => {};
    const handingOff = new Promise<void>((accept) => {
      entered = accept;
    });
    const first = owned.write(Buffer.alloc(3 * 1024 * 1024), {
      signal: new AbortController().signal,
      beforeWrite: () => {
        writes += 1;
        entered();
      },
    });
    first.catch(() => {});
    await handingOff;
    const controller = new AbortController();
    const second = owned.write(Buffer.from('must-not-dispatch'), {
      signal: controller.signal,
      beforeWrite: () => {
        writes += 1;
      },
    });
    second.catch(() => {});
    controller.abort();
    await owned.close();
    await expect(second).rejects.toHaveProperty('code', 'CANCELLED');
    expect(writes).toBe(1);
    await Promise.allSettled([first, second]);
  });
  it('closes an inherited process group even when the leader exits before its descendant holding pipes', async () => {
    const messages = lines();
    const input = await launch(
      "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.stdout.write(String(process.pid)+'\\\\n',()=>process.send('ready'));setInterval(()=>{},1000);\"],{stdio:['ignore',process.stdout,process.stderr,'ipc']});c.once('message',()=>{c.disconnect();c.unref();process.exit(0)});",
    );
    const owned = await startPersistentProcess(
      await resolvePersistentProcess(input),
      { stdout: messages.receive, stdoutEnd: () => {}, fault: () => {} },
      new AbortController().signal,
    );
    processes.push(owned);
    const descendant = Number(await messages.next());
    await owned.closed;
    const inspected = await new Promise<string>((accept) => {
      const child = spawn('/bin/ps', ['-o', 'stat=', '-p', String(descendant)], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let result = '';
      child.stdout.on('data', (chunk: Buffer) => {
        result += chunk.toString();
      });
      child.once('close', () => {
        accept(result.trim());
      });
    });
    expect(inspected === '' || inspected.startsWith('Z')).toBe(true);
  });
  it('keeps the sandbox scope isolated and does not expose inherited home or network policy', async () => {
    const messages = lines();
    const input = await launch(
      "process.stdout.write(JSON.stringify({home:process.env.HOME,tmp:process.env.TMPDIR,secret:process.env.AWS_SECRET_ACCESS_KEY})+'\\n');process.stdin.resume();",
      'sandboxed',
    );
    const owned = await startPersistentProcess(
      await resolvePersistentProcess(input),
      { stdout: messages.receive, stdoutEnd: () => {}, fault: () => {} },
      new AbortController().signal,
    );
    processes.push(owned);
    const value: unknown = JSON.parse(await messages.next());
    if (typeof value !== 'object' || value === null || !('home' in value) || !('tmp' in value))
      throw new Error('Missing child environment');
    expect(typeof value.home === 'string' && value.home.includes('my-pi-mcp-')).toBe(true);
    expect(typeof value.tmp === 'string' && value.tmp.includes('my-pi-mcp-')).toBe(true);
    expect(value).not.toHaveProperty('secret');
    await owned.close();
  });
});

describe('unsupported persistent process platforms', () => {
  it.each(['win32', 'linux'])(
    'rejects %s before resolving or starting a program',
    async (platform) => {
      const original = Object.getOwnPropertyDescriptor(process, 'platform');
      if (original === undefined) throw new Error('Missing process platform descriptor');
      Object.defineProperty(process, 'platform', { configurable: true, value: platform });
      try {
        await expect(
          resolvePersistentProcess({
            command: '/not-started',
            args: [],
            workspaceRoot: '/not-read',
            profileDirectory: '/not-read',
            environment: {},
            scope: 'sandboxed',
          }),
        ).rejects.toHaveProperty('code', 'SANDBOX_UNAVAILABLE');
      } finally {
        Object.defineProperty(process, 'platform', original);
      }
    },
  );
});
