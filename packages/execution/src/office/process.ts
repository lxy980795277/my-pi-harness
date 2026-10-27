import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { ExecutionError, checkCancelled } from '../core/errors.js';
import { stopOwnedProcessGroup, waitForProcessClose } from '../process/cleanup.js';
import { sandboxProfile } from '../process/sandbox.js';
import type { ExecutionContext } from '../core/types.js';

export interface OfficeProcessOptions {
  /** Explicitly installed interpreter; no Run installs Python packages. */
  pythonPath?: string;
  /** Host-owned resource override for packaged distributions. */
  resourceDirectory?: string;
}

async function pythonProgram(configured: string | undefined): Promise<string> {
  if (configured !== undefined) {
    if (!isAbsolute(configured))
      throw new ExecutionError(
        'OFFICE_DEPENDENCY_MISSING',
        'Office Python must be an absolute path',
      );
    try {
      await access(configured);
      return configured;
    } catch (cause) {
      throw new ExecutionError(
        'OFFICE_DEPENDENCY_MISSING',
        'Configured Office Python is unavailable',
        { cause },
      );
    }
  }
  for (const candidate of [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // A missing candidate only means the next supported installation location is considered.
    }
  }
  throw new ExecutionError(
    'OFFICE_DEPENDENCY_MISSING',
    'Python 3 is not installed; prepare office dependencies explicitly',
  );
}

/** Execute one fixed resource with bounded pipes and settle its process group before returning. */
export async function runOfficeProcess(
  request: Record<string, unknown>,
  temporary: string,
  root: string,
  resources: string,
  context: ExecutionContext,
  options: OfficeProcessOptions,
): Promise<string> {
  checkCancelled(context.signal);
  if (process.platform === 'win32')
    throw new ExecutionError(
      'OFFICE_PLATFORM_UNAVAILABLE',
      'Office process supervision is not implemented on Windows',
    );
  const python = await pythonProgram(options.pythonPath);
  const actualPython = await realpath(python);
  const script = `${resources}/runner.py`;
  let program = python;
  let args = ['-B', '-s', script];
  if (context.shellAccess !== 'full-access') {
    if (process.platform !== 'darwin')
      throw new ExecutionError(
        'SANDBOX_UNAVAILABLE',
        'Office isolation is unavailable on this platform',
      );
    const privateDirectory = await realpath(context.profileDirectory);
    const profile =
      sandboxProfile(root, temporary, dirname(dirname(python)), privateDirectory) +
      `\n(allow file-read* (subpath ${JSON.stringify(resources)}) (subpath ${JSON.stringify(dirname(dirname(actualPython)))}) )\n`;
    program = '/usr/bin/sandbox-exec';
    args = ['-p', profile, python, ...args];
  }
  checkCancelled(context.signal);
  const child = spawn(program, args, {
    cwd: temporary,
    detached: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: `${dirname(python)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: temporary,
      TMPDIR: temporary,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  let timer: NodeJS.Timeout | undefined;
  let abort = (): void => {};
  const closed = new Promise<void>((accept) => child.once('close', () => accept()));
  try {
    return await new Promise<string>((accept, reject) => {
      const output: Buffer[] = [];
      let total = 0;
      let stderr = '';
      let errorBytes = 0;
      abort = () => reject(new ExecutionError('CANCELLED', 'Office operation was cancelled'));
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) abort();
      timer = setTimeout(
        () => reject(new ExecutionError('TIMEOUT', 'Office operation exceeded 60 seconds')),
        60_000,
      );
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > 24_000_000) {
          reject(new ExecutionError('OFFICE_OUTPUT_LIMIT', 'Office output exceeded its limit'));
          return;
        }
        output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errorBytes += chunk.length;
        if (errorBytes > 100_000) {
          reject(
            new ExecutionError('OFFICE_OUTPUT_LIMIT', 'Office diagnostics exceeded their limit'),
          );
          return;
        }
        if (stderr.length < 10_000)
          stderr += chunk.toString('utf8').slice(0, 10_000 - stderr.length);
      });
      child.stdin.on('error', () =>
        reject(new ExecutionError('OFFICE_PROCESS_FAILED', 'Office input pipe closed')),
      );
      child.once('error', (cause) =>
        reject(
          new ExecutionError('OFFICE_DEPENDENCY_MISSING', 'Office Python could not start', {
            cause,
          }),
        ),
      );
      child.once('close', (code) => {
        if (code !== 0) {
          reject(
            new ExecutionError(
              'OFFICE_PROCESS_FAILED',
              `Office worker exited unsuccessfully (${String(code)}); verify Python dependencies and OS isolation`,
            ),
          );
          return;
        }
        accept(Buffer.concat(output).toString('utf8'));
      });
      const encoded = JSON.stringify(request);
      if (Buffer.byteLength(encoded) > 500_000) {
        reject(new ExecutionError('OFFICE_INPUT_LIMIT', 'Office request exceeds its input limit'));
        return;
      }
      child.stdin.end(encoded);
    });
  } finally {
    context.signal.removeEventListener('abort', abort);
    if (timer !== undefined) clearTimeout(timer);
    await stopOwnedProcessGroup(child);
    await waitForProcessClose(closed, 2000);
  }
}
