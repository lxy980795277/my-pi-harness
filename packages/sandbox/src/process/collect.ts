import { StringDecoder } from 'node:string_decoder';
import type { SandboxError } from '../errors';
import { startProcess } from './persistent';
import type { ProcessExit, ProcessLaunch } from './types';

/** Collected output is bounded by the resolved process budgets. */
export interface CollectedProcess extends ProcessExit {
  stdout: string;
  stderr: string;
  output: string;
}

/** Run to physical closure; callers needing background lifetime use startProcess directly. */
export async function collectProcess(
  launch: ProcessLaunch,
  signal: AbortSignal,
): Promise<CollectedProcess> {
  const stdout = new StringDecoder('utf8');
  const stderr = new StringDecoder('utf8');
  let stdoutText = '';
  let stderrText = '';
  let output = '';
  let failure: SandboxError | undefined;
  const owned = await startProcess(
    launch,
    {
      stdout: (chunk) => {
        const text = stdout.write(chunk);
        stdoutText += text;
        output += text;
      },
      stdoutEnd: () => {
        const text = stdout.end();
        stdoutText += text;
        output += text;
      },
      stderr: (chunk) => {
        const text = stderr.write(chunk);
        stderrText += text;
        output += text;
      },
      stderrEnd: () => {
        const text = stderr.end();
        stderrText += text;
        output += text;
      },
      fault: (error) => {
        failure ??= error;
      },
    },
    signal,
  );
  await owned.closed;
  if (failure) throw failure;
  const result = await owned.exit;
  return { ...result, stdout: stdoutText, stderr: stderrText, output };
}
