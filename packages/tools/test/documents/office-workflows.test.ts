import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const python =
  process.env['MY_PI_HARNESS_TEST_PYTHON'] ??
  fileURLToPath(new URL('../../../../.cache/office-venv/bin/python', import.meta.url));

it.skipIf(!existsSync(python))(
  'runs the materialized Office Skill CLIs and advanced format helpers',
  async () => {
    const script = fileURLToPath(new URL('./office-workflows.py', import.meta.url));
    const resources = fileURLToPath(new URL('../../resources', import.meta.url));
    await new Promise<void>((accept, reject) => {
      execFile(
        python,
        ['-B', script, resources],
        { timeout: 120_000, maxBuffer: 200_000 },
        (error, _output, stderr) => {
          if (error) reject(new Error(stderr, { cause: error }));
          else {
            expect(stderr).toContain('OK');
            accept();
          }
        },
      );
    });
  },
  125_000,
);
