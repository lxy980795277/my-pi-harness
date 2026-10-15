import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const execute = promisify(execFile);

async function lintFixture(source) {
  const metadataPath = require.resolve('oxlint/package.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const cli = join(dirname(metadataPath), metadata.bin.oxlint);
  const fixtureRoot = join(root, 'output', 'audit');
  await mkdir(fixtureRoot, { recursive: true });
  const temporary = await mkdtemp(join(fixtureRoot, 'a11y-'));
  const fixture = join(temporary, 'fixture.tsx');
  try {
    await writeFile(fixture, source);
    try {
      const { stdout, stderr } = await execute(
        process.execPath,
        [cli, '--config', join(root, '.oxlintrc.json'), '--format', 'json', fixture],
        { cwd: root, shell: false, timeout: 5_000, maxBuffer: 1024 * 1024 },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

describe('real Oxlint accessibility gate', () => {
  it('accepts an image description and a named button using the repository configuration', async () => {
    const result = await lintFixture(`export const Fixture = () => (
  <div>
    <img src="fixture.png" alt="示例截图" />
    <button type="button">继续</button>
  </div>
);
`);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).diagnostics).toEqual([]);
  });

  it.each([
    ['image without alt', '<img src="fixture.png" />', 'alt-text'],
    ['button without a name', '<button type="button" />', 'control-has-associated-label'],
    ['clickable div', '<div onClick={save}>保存</div>', 'no-static-element-interactions'],
    ['clickable span', '<span onClick={save}>保存</span>', 'click-events-have-key-events'],
  ])('rejects an %s with its accessibility rule diagnostic', async (_name, jsx, rule) => {
    const result = await lintFixture(`export const Fixture = () => (${jsx});\n`);
    expect(result.code).not.toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: `jsx-a11y(${rule})`, severity: 'error' }),
      ]),
    );
  });
});
