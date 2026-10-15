import { EventEmitter } from 'node:events';
import { IncomingMessage, type RequestOptions } from 'node:http';
import type * as Http from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  addresses: ['8.8.8.8'],
  responses: [] as { status: number; location?: string; body?: string; encoding?: string }[],
  requests: [] as { url: URL; options: RequestOptions }[],
  cancellations: 0,
}));

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    public resolve4(): Promise<string[]> {
      return Promise.resolve(fixtures.addresses);
    }
    public resolve6(): Promise<string[]> {
      return Promise.resolve([]);
    }
    public cancel(): void {
      fixtures.cancellations += 1;
    }
  },
}));

function request(
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): EventEmitter & { end(body?: string): void } {
  fixtures.requests.push({ url, options });
  const client = new EventEmitter();
  return Object.assign(client, {
    end: () => {
      const fixture = fixtures.responses.shift();
      if (!fixture) throw new Error('Missing HTTP fixture');
      const response = new IncomingMessage(new Socket());
      response.statusCode = fixture.status;
      response.headers = {
        'content-type': 'text/plain',
        ...(fixture.location === undefined ? {} : { location: fixture.location }),
        ...(fixture.encoding === undefined ? {} : { 'content-encoding': fixture.encoding }),
      };
      queueMicrotask(() => {
        callback(response);
        if (!response.destroyed) {
          response.push(Buffer.from(fixture.body ?? 'fixture response'));
          response.push(null);
        }
      });
    },
  });
}
vi.mock('node:http', async (original) => ({
  ...(await original<typeof Http>()),
  request,
}));
vi.mock('node:https', () => ({ request }));

const { executeTool } = await import('../src/index.js');
const context = {
  workspaceRoot: '/unused',
  profileDirectory: '/unused',
  readOnly: false,
  signal: new AbortController().signal,
};

beforeEach(() => {
  fixtures.addresses = ['8.8.8.8'];
  fixtures.responses = [];
  fixtures.requests = [];
  fixtures.cancellations = 0;
});

it('pins the socket lookup to the public DNS answer and disables ambient connection reuse', async () => {
  fixtures.responses.push({ status: 200, body: 'public document' });
  const result = await executeTool(
    'web_fetch',
    { url: 'https://public.example/document' },
    context,
  );
  expect(result.content).toEqual([
    { type: 'text', text: 'URL: https://public.example/document\nHTTP 200\npublic document' },
  ]);
  const options = fixtures.requests[0]?.options;
  expect(options?.agent).toBe(false);
  expect(options?.headers).toMatchObject({ 'accept-encoding': 'identity' });
  const lookup = options?.lookup;
  expect(lookup).toBeTypeOf('function');
  const callback = vi.fn();
  fixtures.addresses = ['127.0.0.1'];
  lookup?.('public.example', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  expect(fixtures.cancellations).toBe(1);
});

it('rejects mixed public/private DNS results before creating a socket', async () => {
  fixtures.addresses = ['8.8.8.8', '127.0.0.1'];
  await expect(
    executeTool('web_fetch', { url: 'http://public.example/' }, context),
  ).rejects.toMatchObject({ code: 'PRIVATE_NETWORK' });
  expect(fixtures.requests).toHaveLength(0);
});

it('checks redirect targets before a second socket can reach loopback', async () => {
  fixtures.responses.push({ status: 302, location: 'http://127.0.0.1/' });
  await expect(
    executeTool('web_fetch', { url: 'http://public.example/' }, context),
  ).rejects.toMatchObject({ code: 'PRIVATE_NETWORK' });
  expect(fixtures.requests).toHaveLength(1);
});

it('follows relative GET redirects but never automatically repeats a POST', async () => {
  fixtures.responses.push({ status: 302, location: '/next' }, { status: 200, body: 'next' });
  expect(
    (await executeTool('web_fetch', { url: 'https://public.example/' }, context)).summary,
  ).toContain('200');
  expect(fixtures.requests[1]?.url.href).toBe('https://public.example/next');
  fixtures.requests = [];
  fixtures.responses.push({ status: 307, location: '/second-write' });
  expect(
    (
      await executeTool(
        'web_fetch',
        { url: 'https://public.example/', method: 'POST', body: '{}' },
        context,
      )
    ).summary,
  ).toContain('not followed');
  expect(fixtures.requests).toHaveLength(1);
});

it('refuses HTTPS downgrades, compression and oversized responses', async () => {
  fixtures.responses.push({ status: 302, location: 'http://public.example/' });
  await expect(
    executeTool('web_fetch', { url: 'https://public.example/' }, context),
  ).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
  fixtures.responses.push({ status: 200, encoding: 'gzip' });
  await expect(
    executeTool('web_fetch', { url: 'https://public.example/' }, context),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  fixtures.responses.push({ status: 200, body: 'x'.repeat(500_001) });
  await expect(
    executeTool('web_fetch', { url: 'https://public.example/' }, context),
  ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
});
