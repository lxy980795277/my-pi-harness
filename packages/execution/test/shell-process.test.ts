import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { expect, it } from 'vitest';
import { collectShellProcess } from '../src/shell-process.js';

function processFixture(): { child: ChildProcess; stdout: PassThrough; stderr: PassThrough } {
  // No PID or OS process is created; only the documented exit/data/close ordering is driven.
  const child = new ChildProcess();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.defineProperties(child, { stdout: { value: stdout }, stderr: { value: stderr } });
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let streamsClosed = 0;
  const closeWhenReady = (): void => {
    if (exit && streamsClosed === 2) child.emit('close', exit.code, exit.signal);
  };
  child.once('exit', (code, signal) => {
    exit = { code, signal };
    closeWhenReady();
  });
  for (const stream of [stdout, stderr])
    stream.once('close', () => {
      streamsClosed += 1;
      closeWhenReady();
    });
  return { child, stdout, stderr };
}

async function observe(task: ReturnType<typeof collectShellProcess>): Promise<unknown> {
  try {
    return await task;
  } catch (error) {
    return error;
  }
}

it('keeps stdout and stderr delivered after leader exit, including split UTF-8 characters', async () => {
  const { child, stdout, stderr } = processFixture();
  const task = collectShellProcess(child, new AbortController().signal, 5000);
  child.emit('exit', 0, null);
  await Promise.resolve();
  const unicode = Buffer.from('尾');
  stdout.write(Buffer.concat([Buffer.from('stdout '), unicode.subarray(0, 1)]));
  stdout.end(unicode.subarray(1));
  await finished(stdout);
  stderr.end(' stderr tail');
  await finished(stderr);
  expect(await task).toEqual({ code: 0, signal: null, output: 'stdout 尾 stderr tail' });
});

it('reports an output overflow arriving after exit instead of returning partial success', async () => {
  const { child, stdout, stderr } = processFixture();
  const observed = observe(collectShellProcess(child, new AbortController().signal, 5000));
  stdout.write('x'.repeat(90_000));
  child.emit('exit', 0, null);
  await Promise.resolve();
  stdout.end('y'.repeat(20_000));
  stderr.end();
  expect(await observed).toMatchObject({ code: 'OUTPUT_LIMIT' });
});

it('does not turn a late output stream error into success', async () => {
  const { child, stdout, stderr } = processFixture();
  const observed = observe(collectShellProcess(child, new AbortController().signal, 5000));
  child.emit('exit', 0, null);
  stdout.emit('error', new Error('synthetic output failure'));
  stdout.end();
  stderr.end();
  expect(await observed).toMatchObject({ code: 'SHELL_OUTPUT_FAILED' });
});

it('retains cancellation while output pipes are still draining', async () => {
  const { child, stdout, stderr } = processFixture();
  const controller = new AbortController();
  const observed = observe(collectShellProcess(child, controller.signal, 5000));
  child.emit('exit', 0, null);
  controller.abort();
  stdout.end('unfinished output');
  stderr.end();
  expect(await observed).toMatchObject({ code: 'CANCELLED' });
});

it('fails and destroys pipes that do not close after leader exit within the cleanup deadline', async () => {
  const { child, stdout, stderr } = processFixture();
  const observed = observe(collectShellProcess(child, new AbortController().signal, 5000));
  child.emit('exit', 0, null);
  expect(await observed).toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
  expect(stdout.destroyed).toBe(true);
  expect(stderr.destroyed).toBe(true);
});
