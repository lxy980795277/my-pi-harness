import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.unstubAllEnvs();
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

  it.each(['.my-pi-harness', '.MY-PI-HARNESS'])(
    'denies sandboxed reads and writes inside %s while explicit full access retains host rights',
    async (name) => {
      await mkdir(join(context.workspaceRoot, name, 'sessions'), { recursive: true });
      const path = `${name}/sessions/session.jsonl`;
      await writeFile(join(context.workspaceRoot, path), 'controlled log data');
      for (const command of [`/bin/cat '${path}'`, `printf changed > '${path}'`])
        await expect(executeTool('shell', { command }, context)).rejects.toMatchObject({
          code: 'SHELL_FAILED',
        });
      expect(await readFile(join(context.workspaceRoot, path), 'utf8')).toBe('controlled log data');
      const result = await executeTool(
        'shell',
        { command: `/bin/cat '${path}'` },
        { ...context, shellAccess: 'full-access' },
      );
      expect(result.content).toEqual([{ type: 'text', text: 'controlled log data' }]);
    },
  );
});

describe.skipIf(process.platform !== 'darwin')('actual macOS full-access execution', () => {
  beforeEach(() => {
    context.shellAccess = 'full-access';
  });

  it('reads and writes a controlled file outside the workspace while sandboxed modes refuse it', async () => {
    const outside = join(directory, 'outside');
    await writeFile(outside, 'controlled external data');
    const command = `/bin/cat '${outside}'; printf updated > '${outside}'`;
    for (const shellAccess of [undefined, 'sandboxed'] as const) {
      const sandboxedContext = { ...context };
      delete sandboxedContext.shellAccess;
      if (shellAccess !== undefined) sandboxedContext.shellAccess = shellAccess;
      await expect(executeTool('shell', { command }, sandboxedContext)).rejects.toMatchObject({
        code: 'SHELL_FAILED',
      });
      expect(await readFile(outside, 'utf8')).toBe('controlled external data');
    }
    const result = await executeTool('shell', { command }, context);
    expect(result.content).toEqual([{ type: 'text', text: 'controlled external data' }]);
    expect(await readFile(outside, 'utf8')).toBe('updated');
  });

  it('uses the registered cwd and real HOME without inheriting credentials or ambient configuration', async () => {
    const startup = join(directory, 'startup');
    await writeFile(startup, 'printf unexpected > startup-ran');
    for (const name of [
      'OPENAI_API_KEY',
      'DEEPSEEK_API_KEY',
      'SSH_AUTH_SOCK',
      'HTTPS_PROXY',
      'NODE_OPTIONS',
      'MY_PI_EXECUTION_TEST_ENV',
    ])
      vi.stubEnv(name, 'fake-execution-secret');
    vi.stubEnv('BASH_ENV', startup);
    const result = await executeTool(
      'shell',
      {
        command:
          'printf "%s|%s|%s|%s|%s|%s|%s|%s|%s" "$PWD" "$HOME" "$OPENAI_API_KEY" "$DEEPSEEK_API_KEY" "$SSH_AUTH_SOCK" "$HTTPS_PROXY" "$NODE_OPTIONS" "$MY_PI_EXECUTION_TEST_ENV" "$BASH_ENV"',
      },
      context,
    );
    expect(result.content).toEqual([
      { type: 'text', text: `${context.workspaceRoot}|${await realpath(homedir())}|||||||` },
    ]);
    await expect(readFile(join(context.workspaceRoot, 'startup-ran'))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  });

  it('keeps file tools and workspace registration restrictions in full-access mode', async () => {
    await writeFile(join(directory, 'outside'), 'controlled external data');
    await expect(executeTool('read_file', { path: '../outside' }, context)).rejects.toMatchObject({
      code: 'PROTECTED_PATH',
    });
    await expect(
      executeTool('shell', { command: 'printf unsafe' }, { ...context, workspaceRoot: directory }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
  });

  it('permits a controlled network request only with full access', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end('controlled response');
    });
    try {
      await new Promise<void>((accept, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', accept);
      });
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('The controlled HTTP server did not obtain a TCP port');
      const command = `/usr/bin/curl --silent --show-error --noproxy "*" --connect-timeout 1 --max-time 2 http://127.0.0.1:${address.port}`;
      await expect(
        executeTool('shell', { command }, { ...context, shellAccess: 'sandboxed' }),
      ).rejects.toMatchObject({ code: 'SHELL_FAILED' });
      expect(requests).toBe(0);
      expect((await executeTool('shell', { command }, context)).content).toEqual([
        { type: 'text', text: 'controlled response' },
      ]);
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((accept, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else accept();
          });
        });
    }
  });
});

describe.skipIf(process.platform !== 'darwin').each(['sandboxed', 'full-access'] as const)(
  'actual macOS %s process ownership',
  (shellAccess) => {
    beforeEach(() => {
      context.shellAccess = shellAccess;
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
      let result: unknown;
      try {
        pid = await waitForPid();
      } finally {
        controller.abort();
        result = await observed;
      }
      expect(result).toMatchObject({ code: 'CANCELLED' });
      expect(await processRunning(pid)).toBe(false);
    });

    it('reaps descendants even if the shell leader returns first', async () => {
      await executeTool(
        'shell',
        { command: '/bin/sleep 60 & echo $! > child.pid; exit 0' },
        context,
      );
      const pid = await waitForPid();
      expect(await processRunning(pid)).toBe(false);
    });

    it('terminates commands on time and output limits', async () => {
      await expect(
        executeTool(
          'shell',
          {
            command:
              '/bin/bash -c \'trap "" TERM; while true; do /bin/sleep 1; done\' & echo $! > child.pid; wait',
            timeoutMs: 1000,
          },
          context,
        ),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      expect(await processRunning(await waitForPid())).toBe(false);
      await expect(
        executeTool('shell', { command: '/usr/bin/yes overflow' }, context),
      ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    });
  },
);

it.each([undefined, 'sandboxed', 'full-access'] as const)(
  'keeps read-only shell refusal with %s access',
  async (shellAccess) => {
    if (shellAccess !== undefined) context.shellAccess = shellAccess;
    await expect(
      executeTool('shell', { command: 'printf unsafe' }, { ...context, readOnly: true }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
  },
);

it.each(['linux', 'win32'] as const)(
  'refuses sandboxed and full-access shell execution on %s',
  async (platform) => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });
    try {
      for (const shellAccess of ['sandboxed', 'full-access'] as const)
        await expect(
          executeTool('shell', { command: 'printf unsafe' }, { ...context, shellAccess }),
        ).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  },
);
