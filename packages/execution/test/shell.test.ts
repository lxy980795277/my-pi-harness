import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, type ExecutionContext } from '../src/index.js';

let directory: string;
let context: ExecutionContext;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'shell-execution-test-')));
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  context = {
    workspaceRoot,
    profileDirectory,
    readOnly: false,
    signal: new AbortController().signal,
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function processRunning(pid: string): Promise<boolean> {
  return await new Promise<boolean>((accept) => {
    execFile('/bin/ps', ['-p', pid, '-o', 'stat='], { timeout: 1000 }, (_error, stdout) => {
      accept(stdout.trim() !== '' && !stdout.trim().startsWith('Z'));
    });
  });
}

async function waitForPid(): Promise<string> {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    try {
      return (await readFile(join(context.workspaceRoot, 'child.pid'), 'utf8')).trim();
    } catch {
      await delay(20);
    }
  }
  throw new Error('Shell child did not start');
}

describe.skipIf(process.platform !== 'darwin')('actual macOS seatbelt execution', () => {
  it('runs in the workspace and excludes ambient credentials', async () => {
    const result = await executeTool(
      'shell',
      { command: 'printf hello > result.txt; printf "%s|%s" "$OPENAI_API_KEY" "$SSH_AUTH_SOCK"' },
      context,
    );
    expect(result.content).toEqual([{ type: 'text', text: '|' }]);
    expect(await readFile(join(context.workspaceRoot, 'result.txt'), 'utf8')).toBe('hello');
  });

  it('preserves large final output and the failing command exit code', async () => {
    const result = await executeTool(
      'shell',
      {
        command:
          'i=0; while [ "$i" -lt 4000 ]; do printf "line output\\n"; i=$((i+1)); done; printf "final stdout tail"; printf "final stderr tail" >&2',
      },
      context,
    );
    const output = result.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('');
    expect(output.match(/line output\n/g)).toHaveLength(4000);
    expect(output).toContain('final stdout tail');
    expect(output).toContain('final stderr tail');
    await expect(
      executeTool('shell', { command: 'printf "failed tail"; exit 7' }, context),
    ).rejects.toThrow('Shell exited with code 7\nfailed tail');
  });

  it('denies reads outside the workspace and of local credential files', async () => {
    await writeFile(join(directory, 'outside'), 'private');
    await writeFile(join(context.workspaceRoot, '.env'), 'secret');
    await expect(
      executeTool('shell', { command: `/bin/cat '${join(directory, 'outside')}'` }, context),
    ).rejects.toMatchObject({ code: 'SHELL_FAILED' });
    await expect(executeTool('shell', { command: '/bin/cat .env' }, context)).rejects.toMatchObject(
      { code: 'SHELL_FAILED' },
    );
  });

  it('denies writes through a symlink escaping the workspace', async () => {
    await expect(
      executeTool(
        'shell',
        { command: `ln -s '${directory}' escape; printf bad > escape/outside` },
        context,
      ),
    ).rejects.toMatchObject({ code: 'SHELL_FAILED' });
    await expect(readFile(join(directory, 'outside'))).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('blocks an actual loopback network request', async () => {
    await expect(
      executeTool(
        'shell',
        { command: '/usr/bin/curl --noproxy "*" --connect-timeout 1 http://127.0.0.1:4311' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'SHELL_FAILED' });
  });

  it('cancels and reaps a child that ignores TERM', async () => {
    const controller = new AbortController();
    const task = executeTool(
      'shell',
      {
        command:
          '/bin/bash -c \'trap "" TERM; while true; do /bin/sleep 1; done\' & echo $! > child.pid; wait',
      },
      { ...context, signal: controller.signal },
    );
    const observed = (async () => {
      try {
        return await task;
      } catch (error) {
        return error;
      }
    })();
    let pid: string;
    try {
      pid = await waitForPid();
    } finally {
      controller.abort();
    }
    expect(await observed).toMatchObject({ code: 'CANCELLED' });
    expect(await processRunning(pid)).toBe(false);
  });

  it('reaps descendants even if the shell leader returns first', async () => {
    await executeTool('shell', { command: '/bin/sleep 60 & echo $! > child.pid; exit 0' }, context);
    const pid = await waitForPid();
    expect(await processRunning(pid)).toBe(false);
  });

  it('terminates commands on time and output limits', async () => {
    await expect(
      executeTool('shell', { command: '/bin/sleep 60', timeoutMs: 100 }, context),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(
      executeTool('shell', { command: '/usr/bin/yes overflow' }, context),
    ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  });
});

it.skipIf(process.platform === 'darwin')(
  'refuses shell without a verified platform sandbox',
  async () => {
    await expect(executeTool('shell', { command: 'echo unsafe' }, context)).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    });
  },
);
