import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSessionLog } from '../src/features/sessions/services/sessions';
import {
  RequestError,
  setCsrfToken,
  subscribeAuthorizationLoss,
} from '../src/services/base-request';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('session JSONL download transport', () => {
  it('preserves exact UTF-8 log bytes through the authenticated file request', async () => {
    const text = '{"title":"对话"}\n{"branch":"first"}\n';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(text, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const log = await fetchSessionLog('session/id', controller.signal);
    expect(await log.text()).toBe(text);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session%2Fid/log',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }),
    );
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('rejects a successful HTML gateway response instead of downloading it as JSONL', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('<html>login'));
      },
      cancel: cancelled,
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/html' } })),
    );
    await expect(fetchSessionLog('session', new AbortController().signal)).rejects.toThrow(
      '文件类型无效',
    );
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('keeps the daemon failure message so the download can be retried explicitly', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json(
            { code: 'SESSION_LOG_UNAVAILABLE', message: '会话日志暂不可用，请重试。' },
            { status: 503 },
          ),
        ),
    );
    await expect(fetchSessionLog('session', new AbortController().signal)).rejects.toEqual(
      new RequestError('会话日志暂不可用，请重试。', 503),
    );
  });

  it.each([
    { message: 'untrusted message without a code' },
    { code: 123, message: 'untrusted code' },
    { code: 'FAILED', message: 123 },
    { code: 'FAILED', message: 'untrusted extra field', detail: 'private host detail' },
  ])('uses a safe HTTP fallback for malformed failure data %j', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body, { status: 503 })),
    );
    await expect(fetchSessionLog('session', new AbortController().signal)).rejects.toEqual(
      new RequestError('本机服务返回错误（HTTP 503），请检查服务后重试。', 503),
    );
  });

  it('still invalidates authorization when a gateway returns a non-JSON 401', async () => {
    const lost = vi.fn();
    const unsubscribe = subscribeAuthorizationLoss(lost);
    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(new Response('<html>login</html>', { status: 401 })),
      );
      await expect(fetchSessionLog('session', new AbortController().signal)).rejects.toEqual(
        new RequestError('本机服务返回错误（HTTP 401），请检查服务后重试。', 401),
      );
      expect(lost).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('notifies the authorization owner when the download rejects the current login', async () => {
    const lost = vi.fn();
    const unsubscribe = subscribeAuthorizationLoss(lost);
    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(
            Response.json({ code: 'LOGIN_REQUIRED', message: '请重新登录。' }, { status: 401 }),
          ),
      );
      await expect(fetchSessionLog('session', new AbortController().signal)).rejects.toEqual(
        new RequestError('请重新登录。', 401),
      );
      expect(lost).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
