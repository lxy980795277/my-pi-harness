import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { requestOperation } from '../src/http/request-operation.js';

const sockets: Socket[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) socket.destroy();
});

function fixture(
  timeoutMs?: Parameters<typeof requestOperation>[3],
  responseCompletion?: Parameters<typeof requestOperation>[4],
) {
  const socket = new Socket();
  sockets.push(socket);
  const request = { raw: new IncomingMessage(socket) };
  const reply = { raw: new ServerResponse(request.raw) };
  let resolve: (value: number) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<number>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const completion = { promise, resolve, reject };
  let ownedSignal: AbortSignal | undefined;
  const task = requestOperation(
    request,
    reply,
    (signal) => {
      ownedSignal = signal;
      return completion.promise;
    },
    timeoutMs,
    responseCompletion,
  );
  if (ownedSignal === undefined) throw new Error('Operation did not acquire its request signal');
  return { request, reply, completion, task, signal: ownedSignal };
}

it.each([
  { policy: 'writableEnded' as const, cancelled: false },
  { policy: 'writableFinished' as const, cancelled: true },
  { policy: 'always' as const, cancelled: true },
])(
  'preserves $policy cancellation while a response has ended but is still buffered',
  async ({ policy, cancelled }) => {
    const f = fixture(null, policy);
    f.reply.raw.end('buffered response');
    expect(f.reply.raw.writableEnded).toBe(true);
    expect(f.reply.raw.writableFinished).toBe(false);
    f.reply.raw.emit('close');
    expect(f.signal.aborted).toBe(cancelled);
    f.completion.resolve(42);
    expect(await f.task).toBe(42);
    expect(f.request.raw.listenerCount('aborted')).toBe(0);
    expect(f.reply.raw.listenerCount('close')).toBe(0);
  },
);

it('cancels on an aborted request and cleans its listeners when the operation rejects', async () => {
  const f = fixture(null);
  const failure = new Error('Owned operation cancelled');
  const rejected = expect(f.task).rejects.toBe(failure);
  f.request.raw.emit('aborted');
  expect(f.signal.aborted).toBe(true);
  f.completion.reject(failure);
  await rejected;
  expect(f.request.raw.listenerCount('aborted')).toBe(0);
  expect(f.reply.raw.listenerCount('close')).toBe(0);
});

it('cancels a disconnected response before it has ended with the default policy', async () => {
  const f = fixture(null);
  f.reply.raw.emit('close');
  expect(f.signal.aborted).toBe(true);
  f.completion.resolve(42);
  await f.task;
});

it('retains the existing default 30 second request deadline', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(f.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.signal.aborted).toBe(true);
  f.completion.resolve(42);
  await f.task;
});

it('leaves a null deadline with the operation owner instead of adding a request timeout', async () => {
  vi.useFakeTimers();
  const f = fixture(null);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.signal.aborted).toBe(false);
  f.completion.resolve(42);
  await f.task;
});

it('releases its request deadline after successful settlement', async () => {
  vi.useFakeTimers();
  const f = fixture(100);
  f.completion.resolve(42);
  await f.task;
  await vi.advanceTimersByTimeAsync(100);
  expect(f.signal.aborted).toBe(false);
});
