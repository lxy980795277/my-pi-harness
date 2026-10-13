import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareNodeCache } from '../../scripts/node-runtime.mjs';

const fixtures = [];
const name = 'node-v24-test';
const executablePath = 'bin/node';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-node-cache-'));
  fixtures.push(directory);
  return directory;
}

async function writeExecutable(installation, content) {
  const executable = join(installation, name, executablePath);
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, content);
  return executable;
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function publishedExecutable(directory) {
  const manifest = JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8'));
  expect(manifest.version).toBe(1);
  return join(directory, manifest.installation, name, executablePath);
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Node runtime cache publication', () => {
  it('reuses a completed manifest without preparing another installation', async () => {
    const directory = await fixture();
    const executable = await prepareNodeCache(
      directory,
      name,
      executablePath,
      async (installation) => {
        await writeExecutable(installation, 'complete');
      },
    );

    expect(await publishedExecutable(directory)).toBe(executable);
    await expect(
      prepareNodeCache(directory, name, executablePath, () => {
        throw new Error('A complete cache must not prepare again');
      }),
    ).resolves.toBe(executable);
    expect(await readFile(executable, 'utf8')).toBe('complete');
  });

  it('ignores an executable without a completion manifest', async () => {
    const directory = await fixture();
    const legacy = await writeExecutable(directory, 'partial');
    const executable = await prepareNodeCache(
      directory,
      name,
      executablePath,
      async (installation) => {
        await writeExecutable(installation, 'complete');
      },
    );

    expect(executable).not.toBe(legacy);
    expect(await readFile(await publishedExecutable(directory), 'utf8')).toBe('complete');
  });

  it.each([
    ['incomplete JSON', '{'],
    ['unknown format', JSON.stringify({ version: 2, installation: `${name}-existing` })],
    ['nonlocal installation', JSON.stringify({ version: 1, installation: `${name}-existing/..` })],
  ])(
    'prepares a new installation instead of trusting a manifest with %s',
    async (_label, content) => {
      const directory = await fixture();
      await writeExecutable(directory, 'legacy');
      await writeExecutable(join(directory, `${name}-existing`), 'old');
      await writeFile(join(directory, `${name}.json`), content);

      const executable = await prepareNodeCache(
        directory,
        name,
        executablePath,
        async (installation) => {
          await writeExecutable(installation, 'complete');
        },
      );

      expect(await publishedExecutable(directory)).toBe(executable);
      expect(await readFile(executable, 'utf8')).toBe('complete');
    },
  );

  it('replaces a manifest whose executable is missing', async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, `${name}.json`),
      JSON.stringify({
        version: 1,
        installation: `${name}-missing`,
      }),
    );

    const executable = await prepareNodeCache(
      directory,
      name,
      executablePath,
      async (installation) => {
        await writeExecutable(installation, 'complete');
      },
    );

    expect(await publishedExecutable(directory)).toBe(executable);
    expect(await readFile(executable, 'utf8')).toBe('complete');
  });

  it('does not publish or retain a failed preparation', async () => {
    const directory = await fixture();
    await expect(
      prepareNodeCache(directory, name, executablePath, async (installation) => {
        await writeExecutable(installation, 'partial');
        throw new Error('Extraction failed');
      }),
    ).rejects.toThrow('Extraction failed');

    await expect(access(join(directory, `${name}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(directory)).toEqual([]);
  });

  it('does not publish a preparation that omitted the executable', async () => {
    const directory = await fixture();
    await expect(
      prepareNodeCache(directory, name, executablePath, async () => {}),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await readdir(directory)).toEqual([]);
  });

  it('publishes only completed installations while concurrent preparations remain private', async () => {
    const directory = await fixture();
    const entered = deferred();
    const gates = [deferred(), deferred()];
    const installations = [];
    let preparationCount = 0;
    let readyCount = 0;
    const prepare = async (installation) => {
      const index = preparationCount++;
      installations.push(installation);
      await writeExecutable(installation, 'partial');
      if (++readyCount === 2) entered.resolve();
      await gates[index].promise;
      await writeExecutable(installation, `complete-${index}`);
    };
    const calls = [
      prepareNodeCache(directory, name, executablePath, prepare),
      prepareNodeCache(directory, name, executablePath, prepare),
    ];

    try {
      await entered.promise;
      expect(new Set(installations).size).toBe(2);
      await expect(access(join(directory, `${name}.json`))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      gates[0].resolve();
      const first = await Promise.race(calls);
      expect(await publishedExecutable(directory)).toBe(first);
      expect(await readFile(first, 'utf8')).toBe('complete-0');
      await expect(
        prepareNodeCache(directory, name, executablePath, () => {
          throw new Error('Readers must use the already completed installation');
        }),
      ).resolves.toBe(first);

      gates[1].resolve();
      const executables = await Promise.all(calls);
      expect(new Set(executables).size).toBe(2);
      expect(await readFile(await publishedExecutable(directory), 'utf8')).toBe('complete-1');
      expect(await readFile(first, 'utf8')).toBe('complete-0');
    } finally {
      for (const gate of gates) gate.resolve();
      await Promise.allSettled(calls);
    }
  });
});
