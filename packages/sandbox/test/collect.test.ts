import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectProcess, resolveProcess, startProcess, type ProcessInput } from '../src/index.js';

let directory: string;
let input: ProcessInput;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'process-collect-')));
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  input = {
    command: process.execPath,
    args: [],
    workspaceRoot,
    profileDirectory,
    environment: {},
    scope: 'full-access',
    limits: { terminateGraceMs: 100 },
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function collect(code: string, overrides: Partial<ProcessInput> = {}) {
  return await collectProcess(
    await resolveProcess({ ...input, ...overrides, args: ['-e', code] }),
    new AbortController().signal,
  );
}

describe.skipIf(process.platform !== 'darwin')('bounded process collection', () => {
  it('preserves split UTF-8 and final stdout/stderr bytes until physical pipe closure', async () => {
    const result = await collect(
      "const b=Buffer.from('尾');process.stdout.write(b.subarray(0,1));process.stdout.write(b.subarray(1));process.stdout.write('x'.repeat(200000));process.stderr.write('final-stderr')",
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('尾' + 'x'.repeat(200000));
    expect(result.stderr).toBe('final-stderr');
    expect(result.output).toContain('final-stderr');
  });

  it('reports nonzero exit as a known result rather than a cleanup failure', async () => {
    expect(await collect("console.log('partial');process.exitCode=7")).toMatchObject({
      code: 7,
      stdout: 'partial\n',
      signal: null,
    });
  });

  it('terminates on cumulative output and lifetime limits', async () => {
    await expect(
      collect("process.stdout.write('x'.repeat(2000));setInterval(()=>{},1000)", {
        ...input,
        limits: { stdoutBytes: 1000, terminateGraceMs: 100 },
      }),
    ).rejects.toHaveProperty('code', 'OUTPUT_LIMIT');
    await expect(
      collect("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", {
        ...input,
        limits: { lifetimeMs: 100, terminateGraceMs: 100 },
      }),
    ).rejects.toHaveProperty('code', 'TIMEOUT');
  });

  it('rejects invalid limits before starting a program', async () => {
    for (const lifetimeMs of [-1, 0, Infinity, 2 ** 32])
      await expect(resolveProcess({ ...input, limits: { lifetimeMs } })).rejects.toHaveProperty(
        'code',
        'INVALID_LIMIT',
      );
  });

  it('rejects replaced program arguments, workspace and resources before spawn', async () => {
    const script = join(input.workspaceRoot, 'script.js');
    await writeFile(script, "require('node:fs').writeFileSync('started','bad')");
    const launch = await resolveProcess({ ...input, args: [script] });
    await writeFile(script, "require('node:fs').writeFileSync('started','changed')");
    await expect(
      startProcess(
        launch,
        { stdout: () => {}, stdoutEnd: () => {}, fault: () => {} },
        new AbortController().signal,
      ),
    ).rejects.toHaveProperty('code', 'PROGRAM_CHANGED');
    const workspaceLaunch = await resolveProcess(input);
    await rename(input.workspaceRoot, join(directory, 'old-workspace'));
    await mkdir(input.workspaceRoot);
    await expect(
      startProcess(
        workspaceLaunch,
        { stdout: () => {}, stdoutEnd: () => {}, fault: () => {} },
        new AbortController().signal,
      ),
    ).rejects.toHaveProperty('code', 'PROGRAM_CHANGED');
    const resource = join(directory, 'resource');
    await mkdir(resource);
    const resourceLaunch = await resolveProcess({ ...input, readOnlyDirectories: [resource] });
    await rename(resource, join(directory, 'old-resource'));
    await mkdir(resource);
    await expect(
      startProcess(
        resourceLaunch,
        { stdout: () => {}, stdoutEnd: () => {}, fault: () => {} },
        new AbortController().signal,
      ),
    ).rejects.toHaveProperty('code', 'PROGRAM_CHANGED');
    await expect(readFile(join(input.workspaceRoot, 'started'))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  });
});
