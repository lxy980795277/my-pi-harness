import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Value } from 'typebox/value';
import { WebCredentialInputSchema, WebSearchInputSchema } from '@my-pi-harness/protocol';
import { DeepSeekWebClient } from '../src/web/deepseek';

const dns = vi.hoisted(() => ({ addresses: ['8.8.8.8'], ipv6: [] as string[] }));
const key = 'fixture-deepseek-key';
const activeSignal = new AbortController().signal;
const item = {
  title: 'A public source',
  url: 'https://example.com/article',
  snippet: 'Short context',
  summary: 'Long context',
  content: '',
  site_name: 'Example',
  site_icon: null,
  date: '2026-11-12T07:00:00+00:00',
  rerank_score: 2.4,
  authority: 3,
};

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    public resolve4(): Promise<string[]> {
      return Promise.resolve(dns.addresses);
    }
    public resolve6(): Promise<string[]> {
      return Promise.resolve(dns.ipv6);
    }
    public cancel(): void {}
  },
}));

beforeEach(() => {
  dns.addresses = ['8.8.8.8'];
  dns.ipv6 = [];
});
afterEach(() => vi.restoreAllMocks());

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected a serialized JSON request');
  return JSON.parse(init.body) as unknown;
}

describe('public web request validation', () => {
  it('counts Unicode characters and rejects blank, excessive and undeclared parameters', () => {
    expect(Value.Check(WebSearchInputSchema, { query: '😀'.repeat(128) })).toBe(true);
    for (const value of [
      { query: '😀'.repeat(129) },
      { query: ' \n\t' },
      { query: 'source', count: 0 },
      { query: 'source', count: 51 },
      { query: 'source', count: 1.5 },
      { query: 'source', apiKey: key },
    ])
      expect(Value.Check(WebSearchInputSchema, value)).toBe(false);
    expect(Value.Check(WebCredentialInputSchema, { apiKey: '  ' })).toBe(false);
    for (const apiKey of ['key\r\nheader: value', 'key\0secret', 'key value', '中文Key'])
      expect(Value.Check(WebCredentialInputSchema, { apiKey })).toBe(false);
  });
});

describe('official DeepSeek web transport', () => {
  it('uses the fixed official endpoint and maps the documented wire fields', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [item] }));
    const client = new DeepSeekWebClient({ fetch: request });
    const result = await client.search(
      {
        query: 'site:example.com source',
        count: 3,
        oriQuestion: 'Which source?',
        localization: '1.1.1.1',
        needContent: true,
      },
      key,
      activeSignal,
    );
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    });
    expect(requestBody(init)).toEqual({
      query: 'site:example.com source',
      count: 3,
      ori_question: 'Which source?',
      localization: '1.1.1.1',
      need_content: true,
    });
    expect(result).toEqual({
      results: [
        {
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          summary: item.summary,
          content: '',
          siteName: 'Example',
          siteIcon: null,
          date: item.date,
          rerankScore: 2.4,
          authority: 3,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('returns an empty search result without fabricating a source', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [] }));
    const result = await new DeepSeekWebClient({ fetch: request }).search(
      { query: 'none' },
      key,
      activeSignal,
    );
    expect(result).toEqual({ results: [] });
    expect(requestBody(request.mock.calls[0]?.[1])).toEqual({
      query: 'none',
      count: 10,
      need_content: false,
    });
  });

  it.each([
    { query: 'Look at http://127.0.0.1/api/skill-gateway/github/user' },
    { query: 'Look at “https://localhost”.' },
    { query: 'Look at http://10.0.0.1:3000/service' },
    { query: 'Look at https://server.internal/page' },
    { query: 'http://[::1]' },
    { query: 'http://[fd00::1]' },
    { query: '[local](http://[::1])' },
    { query: '[http://[::1]]' },
    { query: '[http://127.0.0.1]' },
    { query: 'Look at https://user:password@example.com/path' },
    { query: 'public source', oriQuestion: 'Use https://example.com/path?api_key=private' },
  ])('does not send recognizable private URL references in search text', async (input) => {
    const request = vi.fn<typeof fetch>();
    await expect(
      new DeepSeekWebClient({ fetch: request }).search(input, key, activeSignal),
    ).rejects.toMatchObject({ name: 'WebServiceError' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    'site:example.invalid after:2026-11-01',
    'Search “https://example.invalid/docs”.',
    'How does http:// work?',
    'https://[2001:4860:4860::8888]',
    '[https://[2001:4860:4860::8888]]',
  ])(
    'preserves search syntax, public URL examples and incomplete URL examples: %s',
    async (query) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [] }));
      await expect(
        new DeepSeekWebClient({ fetch: request }).search({ query }, key, activeSignal),
      ).resolves.toEqual({ results: [] });
      expect(requestBody(request.mock.calls[0]?.[1])).toMatchObject({ query });
    },
  );

  it('extracts Markdown while retaining the canonical requested public URL', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ title: '', content: '# A page\n\nBody' }));
    const result = await new DeepSeekWebClient({ fetch: request }).fetchPage(
      { url: 'https://8.8.8.8/page#section' },
      key,
      activeSignal,
    );
    expect(result).toEqual({ url: 'https://8.8.8.8/page', title: '', content: '# A page\n\nBody' });
    expect(request.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/v1/tools/fetch');
    expect(timeout).toHaveBeenCalledExactlyOnceWith(60_000);
    expect(requestBody(request.mock.calls[0]?.[1])).toEqual({
      url: 'https://8.8.8.8/page',
    });
  });

  it.each([
    'http://127.0.0.1/api/skill-gateway/github/user',
    'http://localhost/path',
    'http://host.local/path',
    'http://10.1.2.3/path',
    'https://[::ffff:169.254.169.254]/metadata',
    'https://user:password@example.com/path',
    'file:///private/data',
    'https://example.com:5000/path',
    'https://example.com/path?access_token=private',
  ])('does not disclose a disallowed target to the provider: %s', async (url) => {
    const request = vi.fn<typeof fetch>();
    await expect(
      new DeepSeekWebClient({ fetch: request }).fetchPage({ url }, key, activeSignal),
    ).rejects.toMatchObject({ name: 'WebServiceError' });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a private AAAA answer even when the A answer is public', async () => {
    dns.ipv6 = ['::ffff:10.0.0.2'];
    const request = vi.fn<typeof fetch>();
    await expect(
      new DeepSeekWebClient({ fetch: request }).fetchPage(
        { url: 'https://example.com/page' },
        key,
        activeSignal,
      ),
    ).rejects.toMatchObject({ code: 'WEB_PRIVATE_NETWORK' });
    expect(request).not.toHaveBeenCalled();
  });

  it('reports missing DNS answers without sending the target URL', async () => {
    dns.addresses = [];
    const request = vi.fn<typeof fetch>();
    await expect(
      new DeepSeekWebClient({ fetch: request }).fetchPage(
        { url: 'https://example.com/page' },
        key,
        activeSignal,
      ),
    ).rejects.toMatchObject({ code: 'WEB_DNS_FAILED' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'WEB_AUTH_FAILED'],
    [402, 'WEB_BALANCE_REQUIRED'],
    [403, 'WEB_FORBIDDEN'],
    [404, 'WEB_NOT_FOUND'],
    [408, 'WEB_TIMEOUT'],
    [413, 'WEB_RESPONSE_LIMIT'],
    [429, 'WEB_RATE_LIMITED'],
    [500, 'WEB_UPSTREAM_FAILED'],
    [504, 'WEB_TIMEOUT'],
  ])('maps HTTP %i without retrying or exposing its body', async (status, code) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { message: key } }, { status }));
    const operation = new DeepSeekWebClient({ fetch: request }).search(
      { query: 'source' },
      key,
      activeSignal,
    );
    await expect(operation).rejects.toMatchObject({ code, upstreamStatus: status });
    try {
      await operation;
    } catch (error) {
      expect(String(error)).not.toContain(key);
    }
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 401, contentType: 'application/json', code: 'WEB_AUTH_FAILED' },
    { status: 200, contentType: 'text/html', code: 'WEB_INVALID_RESPONSE' },
  ])(
    'preserves a known response error when body cleanup rejects',
    async ({ status, contentType, code }) => {
      const cleanup = vi.fn(() => {
        throw new Error('Synthetic cleanup failure');
      });
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            cancel: cleanup,
          }),
          { status, headers: { 'content-type': contentType } },
        ),
      );
      await expect(
        new DeepSeekWebClient({ fetch: request }).search({ query: 'public' }, key, activeSignal),
      ).rejects.toMatchObject({ code });
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { results: [{ ...item, rerank_score: 5 }] },
    { results: [{ ...item, summary: undefined }] },
    { results: [{ ...item, date: 'yesterday' }] },
    { results: Array.from({ length: 51 }, () => item) },
    { error: { message: 'not a result' } },
  ])('rejects malformed successful search responses', async (body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(
      new DeepSeekWebClient({ fetch: request }).search({ query: 'source' }, key, activeSignal),
    ).rejects.toMatchObject({ code: 'WEB_INVALID_RESPONSE' });
  });

  it('never publishes a provider response echoing the credential, including JSON escapes', async () => {
    const encoded = JSON.stringify({ results: [{ ...item, summary: key }] }).replace(
      key,
      '\\u0066ixture-deepseek-key',
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(encoded, { headers: { 'content-type': 'application/json' } }),
      );
    await expect(
      new DeepSeekWebClient({ fetch: request }).search({ query: 'source' }, key, activeSignal),
    ).rejects.toMatchObject({ code: 'WEB_INVALID_RESPONSE' });
  });

  it.each([
    new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ])('rejects HTML, malformed JSON and non-UTF-8 responses', async (response) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      new DeepSeekWebClient({ fetch: request }).search({ query: 'source' }, key, activeSignal),
    ).rejects.toMatchObject({ code: 'WEB_INVALID_RESPONSE' });
  });

  it('limits response bytes before parsing or returning content', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ results: [{ ...item, content: 'x'.repeat(4 * 1024 * 1024) }] }),
      );
    await expect(
      new DeepSeekWebClient({ fetch: request }).search({ query: 'source' }, key, activeSignal),
    ).rejects.toMatchObject({ code: 'WEB_RESPONSE_LIMIT' });
  });

  it('does not start transport after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn<typeof fetch>();
    await expect(
      new DeepSeekWebClient({ fetch: request }).search({ query: 'source' }, key, controller.signal),
    ).rejects.toMatchObject({ code: 'WEB_CANCELLED' });
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels an incomplete response stream and settles the read', async () => {
    const cancelled = vi.fn();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          markStarted();
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    const controller = new AbortController();
    const operation = new DeepSeekWebClient({ fetch: request }).search(
      { query: 'source' },
      key,
      controller.signal,
    );
    await started;
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: 'WEB_CANCELLED' });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('times out an unresponsive transport without retries', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Timed out', 'TimeoutError')),
          { once: true },
        );
        markStarted();
      });
    });
    const operation = new DeepSeekWebClient({ fetch: request }).search(
      { query: 'source' },
      key,
      activeSignal,
    );
    const rejected = expect(operation).rejects.toMatchObject({ code: 'WEB_TIMEOUT' });
    await started;
    deadline.abort(new DOMException('Request timed out', 'TimeoutError'));
    await rejected;
    expect(request).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledExactlyOnceWith(60_000);
  });
});
