import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { expect, it, vi } from 'vitest';
import { WebService } from '../src/web/service';

const EMPTY_RESULT = { results: [] };

it('uses only the dedicated credential and sends it solely to the fixed official endpoint', async () => {
  const credentials = createMemoryCredentialStore(new Map([['chat.provider', 'chat-secret']]));
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(EMPTY_RESULT)));
  const web = new WebService({ credentials, fetch: transport });
  try {
    expect(await web.status()).toEqual({ provider: 'deepseek', configured: false });
    await expect(web.search({ query: 'test' }, AbortSignal.timeout(2000))).rejects.toMatchObject({
      code: 'WEB_NOT_CONFIGURED',
    });
    expect(transport).not.toHaveBeenCalled();
    expect(await web.setCredential('official-key')).toEqual({
      provider: 'deepseek',
      configured: true,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(await web.search({ query: 'test' }, AbortSignal.timeout(2000))).toEqual(EMPTY_RESULT);
    const call = transport.mock.calls[0];
    expect(call?.[0]).toBe('https://api.deepseek.com/v1/tools/search');
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer official-key');
    expect(await web.setCredential(undefined)).toEqual({ provider: 'deepseek', configured: false });
    expect(await credentials.read('chat.provider')).toBe('chat-secret');
  } finally {
    await web.close();
  }
});

it.each([
  'http://127.0.0.1:4311/api/skill-gateway/github/user',
  'https://service.internal/page',
  'http://192.168.1.10/page',
  'https://user:password@example.com/page',
])('refuses protected page targets before the provider transport: %s', async (url) => {
  const transport = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ title: '', content: '' })),
  );
  const web = new WebService({ credentials: createMemoryCredentialStore(), fetch: transport });
  try {
    await web.setCredential('fixture-key');
    await expect(web.fetchPage({ url }, AbortSignal.timeout(2000))).rejects.toMatchObject({
      name: 'WebServiceError',
    });
    expect(transport).not.toHaveBeenCalled();
  } finally {
    await web.close();
  }
});

it('replacement, deletion and caller cancellation abort old requests without stale results', async () => {
  const credentials = createMemoryCredentialStore();
  const started = gate<AbortSignal>();
  let pending = true;
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error('Expected owned request signal');
    if (!pending) return Response.json(EMPTY_RESULT);
    started.resolve(signal);
    return await new Promise<Response>((_accept, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          const reason: unknown = signal.reason;
          reject(reason instanceof Error ? reason : new Error('Cancelled fixture'));
        },
        { once: true },
      );
    });
  });
  const web = new WebService({ credentials, fetch: transport });
  try {
    await web.setCredential('old-key');
    const request = web.search({ query: 'cancel me' }, AbortSignal.timeout(5000));
    const rejected = expect(request).rejects.toBeInstanceOf(Error);
    const signal = await started.promise;
    await web.setCredential('new-key');
    expect(signal.aborted).toBe(true);
    await rejected;
    pending = false;
    await web.search({ query: 'new request' }, AbortSignal.timeout(2000));
    const call = transport.mock.calls.at(-1);
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer new-key');
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(web.search({ query: 'never send' }, cancelled.signal)).rejects.toBeInstanceOf(
      Error,
    );
    expect(transport).toHaveBeenCalledTimes(2);
    await web.setCredential(undefined);
    await expect(web.search({ query: 'removed' }, AbortSignal.timeout(2000))).rejects.toMatchObject(
      { code: 'WEB_NOT_CONFIGURED' },
    );
  } finally {
    await web.close();
  }
});

it('shutdown waits for an acquired credential operation and refuses new work', async () => {
  const credentials = createMemoryCredentialStore();
  const entered = gate<void>();
  const release = gate<void>();
  const write = credentials.write.bind(credentials);
  vi.spyOn(credentials, 'write').mockImplementation(async (ref, value) => {
    entered.resolve();
    await release.promise;
    await write(ref, value);
  });
  const web = new WebService({ credentials });
  const change = web.setCredential('fixture');
  const rejected = expect(change).rejects.toMatchObject({ code: 'WEB_CLOSED' });
  await entered.promise;
  let finished = false;
  const close = web.close().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  await expect(web.status()).rejects.toMatchObject({ code: 'WEB_CLOSED' });
  release.resolve();
  await Promise.all([close, rejected]);
  expect(finished).toBe(true);
  expect(web.close()).toBe(web.close());
});

it('credential backend failures are safe and do not poison the next configuration change', async () => {
  const credentials = createMemoryCredentialStore();
  vi.spyOn(credentials, 'write').mockRejectedValueOnce(new Error('keyring detail secret-value'));
  const web = new WebService({ credentials });
  try {
    await expect(web.setCredential('first')).rejects.toMatchObject({
      code: 'WEB_CREDENTIAL_UNAVAILABLE',
      message: '联网搜索凭据无法保存，请检查系统凭据服务。',
    });
    expect(await web.setCredential('next')).toEqual({ provider: 'deepseek', configured: true });
    vi.spyOn(credentials, 'read').mockRejectedValueOnce(new Error('private keyring detail'));
    await expect(web.status()).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_UNAVAILABLE' });
  } finally {
    await web.close();
  }
});

it('returns each credential mutation result without rereading or waiting for a later mutation', async () => {
  const credentials = createMemoryCredentialStore();
  const read = vi.spyOn(credentials, 'read');
  const remove = credentials.delete.bind(credentials);
  const entered = gate<void>();
  const release = gate<void>();
  vi.spyOn(credentials, 'delete').mockImplementation(async (ref) => {
    entered.resolve();
    await release.promise;
    await remove(ref);
  });
  const web = new WebService({ credentials });
  const saved = web.setCredential('fixture-key');
  const removed = web.setCredential(undefined);
  let savedResult: unknown;
  const observed = saved.then((result) => {
    savedResult = result;
  });
  try {
    await entered.promise;
    await vi.waitFor(() => {
      expect(savedResult).toEqual({ provider: 'deepseek', configured: true });
    });
    expect(read).not.toHaveBeenCalled();
    release.resolve();
    await expect(removed).resolves.toEqual({ provider: 'deepseek', configured: false });
    expect(read).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await Promise.allSettled([saved, removed, observed]);
    await web.close();
  }
});

it('cancels a caller waiting for configuration while the owned system write still completes', async () => {
  const credentials = createMemoryCredentialStore();
  const entered = gate<void>();
  const release = gate<void>();
  const write = credentials.write.bind(credentials);
  vi.spyOn(credentials, 'write').mockImplementation(async (ref, value) => {
    entered.resolve();
    await release.promise;
    await write(ref, value);
  });
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(EMPTY_RESULT)));
  const web = new WebService({ credentials, fetch: transport });
  const saved = web.setCredential('fixture-key');
  let query: Promise<unknown> | undefined;
  try {
    await entered.promise;
    const caller = new AbortController();
    let failure: unknown;
    query = web
      .search({ query: 'cancel before key is saved' }, caller.signal)
      .catch((error: unknown) => {
        failure = error;
      });
    caller.abort();
    await vi.waitFor(() => {
      expect(failure).toMatchObject({ name: 'AbortError' });
    });
    expect(transport).not.toHaveBeenCalled();
    release.resolve();
    await expect(saved).resolves.toEqual({ provider: 'deepseek', configured: true });
    expect(await web.status()).toEqual({ provider: 'deepseek', configured: true });
  } finally {
    release.resolve();
    await Promise.allSettled([saved, query]);
    await web.close();
  }
});

it('includes configuration waiting in the web request deadline', async () => {
  const credentials = createMemoryCredentialStore();
  const entered = gate<void>();
  const release = gate<void>();
  const write = credentials.write.bind(credentials);
  vi.spyOn(credentials, 'write').mockImplementation(async (ref, value) => {
    entered.resolve();
    await release.promise;
    await write(ref, value);
  });
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(EMPTY_RESULT)));
  const web = new WebService({ credentials, fetch: transport });
  const saved = web.setCredential('fixture-key');
  let query: Promise<unknown> | undefined;
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementationOnce((milliseconds) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException('Fixture deadline', 'TimeoutError')),
      milliseconds,
    );
    return controller.signal;
  });
  try {
    await entered.promise;
    let failure: unknown;
    query = web
      .search({ query: 'deadline during configuration' }, new AbortController().signal)
      .catch((error: unknown) => {
        failure = error;
      });
    expect(timeout).toHaveBeenCalledWith(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failure).toMatchObject({ name: 'TimeoutError' });
    expect(transport).not.toHaveBeenCalled();
    release.resolve();
    await expect(saved).resolves.toEqual({ provider: 'deepseek', configured: true });
  } finally {
    release.resolve();
    await Promise.allSettled([saved, query]);
    await web.close();
    timeout.mockRestore();
    vi.useRealTimers();
  }
});

function gate<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve = (_value: T): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
