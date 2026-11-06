import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ProcessResult {
  stdout: string;
  stderr: string;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const probe = fileURLToPath(new URL('./support/tools-resources-probe.mjs', import.meta.url));

async function execute(
  program: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((accept, reject) => {
    execFile(
      program,
      args,
      { cwd, env, timeout: 90_000, maxBuffer: 2_000_000 },
      (cause, stdout, stderr) => {
        if (cause)
          reject(new Error(`Deployment resource command failed: ${stdout}\n${stderr}`, { cause }));
        else accept({ stdout, stderr });
      },
    );
  });
}

async function installedPackageCache(): Promise<{ store: string; metadata: string }> {
  const installed: unknown = JSON.parse(
    await readFile(join(root, 'node_modules/.modules.yaml'), 'utf8'),
  );
  if (
    typeof installed !== 'object' ||
    installed === null ||
    !('storeDir' in installed) ||
    typeof installed.storeDir !== 'string' ||
    !isAbsolute(installed.storeDir)
  )
    throw new Error('Production deploy verification requires the installed pnpm store metadata');
  const cache = process.env['XDG_CACHE_HOME'];
  return {
    store: installed.storeDir,
    metadata: cache === undefined ? join(homedir(), 'Library/Caches/pnpm') : join(cache, 'pnpm'),
  };
}

async function pythonProgram(): Promise<string> {
  const configured = process.env['MY_PI_HARNESS_TEST_PYTHON'];
  if (configured !== undefined) {
    await access(configured);
    return configured;
  }
  for (const candidate of [
    join(root, '.cache/office-venv/bin/python'),
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          ['ENOENT', 'EACCES'].includes(String(error.code))
        )
      )
        throw error;
    }
  }
  throw new Error(
    'Deployed CLI verification requires an available Python interpreter; dependencies are never installed by this test',
  );
}

/** Loads a production-only deployment through its packaged source exports and tsx dependency. */
describe.skipIf(process.platform !== 'darwin')('deployed tool and sandbox resources', () => {
  it('loads production packages, extracts PDF text and executes four materialized Skill CLIs', async () => {
    const pnpm = process.env['npm_execpath'];
    if (!pnpm) throw new Error('Run through pnpm test:artifact to supply the installed pnpm CLI');
    const python = await pythonProgram();
    const cache = await installedPackageCache();
    const fixture = await realpath(await mkdtemp(join(tmpdir(), 'tools-production-deploy-')));
    const deployment = join(fixture, 'daemon');
    const home = join(fixture, 'home');
    const temporary = join(fixture, 'temporary');
    await mkdir(home);
    await mkdir(temporary);
    const environment: NodeJS.ProcessEnv = {
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: temporary,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      CI: 'true',
      npm_config_userconfig: '/dev/null',
    };
    try {
      await execute(
        process.execPath,
        [
          pnpm,
          '--filter',
          '@my-pi-harness/daemon',
          'deploy',
          '--prod',
          '--legacy',
          '--prefer-offline',
          '--ignore-scripts',
          '--store-dir',
          cache.store,
          '--cache-dir',
          cache.metadata,
          deployment,
        ],
        root,
        environment,
      );
      // Legacy pnpm deploy can create a daemon self-link to the source checkout.
      await rm(join(deployment, 'node_modules/.pnpm/node_modules/@my-pi-harness/daemon'), {
        force: true,
      });
      const deployedProbe = join(deployment, 'resource-probe.mjs');
      await copyFile(probe, deployedProbe);
      const result = await execute(
        process.execPath,
        ['--import', 'tsx', deployedProbe, fixture, python],
        deployment,
        environment,
      );
      const lines = result.stdout.trim().split('\n');
      const last = lines.at(-1);
      if (last === undefined) throw new Error('Missing deployed resource report');
      const report: unknown = JSON.parse(last);
      expect(report).toMatchObject({
        packages: 'deployed-source',
        pdfText: true,
        materializedSkills: 4,
      });
      if (
        typeof report !== 'object' ||
        report === null ||
        !('office' in report) ||
        !Array.isArray(report.office)
      )
        throw new Error('Invalid deployed resource report');
      expect(report.office).toHaveLength(4);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 120_000);
});
