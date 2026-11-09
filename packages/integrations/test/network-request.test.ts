import { EventEmitter } from 'node:events';
import { IncomingMessage, type RequestOptions } from 'node:http';
import type * as Http from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  addresses: ['8.8.8.8'],
  ipv6Addresses: [] as string[],
  requests: [] as { url: URL; options: RequestOptions }[],
}));

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    public resolve4(): Promise<string[]> {
      return Promise.resolve(fixtures.addresses);
    }
    public resolve6(): Promise<string[]> {
      return Promise.resolve(fixtures.ipv6Addresses);
    }
    public cancel(): void {}
  },
}));

function request(
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): EventEmitter & { end(): void } {
  fixtures.requests.push({ url, options });
  return Object.assign(new EventEmitter(), {
    end: () => {
      const response = new IncomingMessage(new Socket());
      response.statusCode = 200;
      response.headers = { 'content-type': 'text/plain' };
      queueMicrotask(() => {
        callback(response);
        response.push(Buffer.from('Remote fixture'));
        response.push(null);
      });
    },
  });
}

vi.mock('node:http', async (original) => ({ ...(await original<typeof Http>()), request }));
vi.mock('node:https', () => ({ request }));

const { createRemoteFetch } = await import('../src/network/remote-fetch');

beforeEach(() => {
  fixtures.addresses = ['8.8.8.8'];
  fixtures.ipv6Addresses = [];
  fixtures.requests = [];
});

it('pins remote sockets to the validated DNS result and keeps authentication on that request', async () => {
  const fetch = createRemoteFetch({ allowedOrigins: new Set(['https://remote.example']) });
  const response = await fetch('https://remote.example/mcp', {
    headers: { authorization: 'fake-remote-token' },
  });
  expect(await response.text()).toBe('Remote fixture');
  const options = fixtures.requests[0]?.options;
  expect(options?.agent).toBe(false);
  expect(options?.headers).toMatchObject({ authorization: 'fake-remote-token' });
  fixtures.addresses = ['127.0.0.1'];
  const callback = vi.fn();
  options?.lookup?.('remote.example', {}, callback);
  expect(callback).toHaveBeenLastCalledWith(null, '8.8.8.8', 4);
  options?.lookup?.('remote.example', { all: true }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
});

it('refuses a private AAAA answer before sending any authentication', async () => {
  fixtures.ipv6Addresses = ['::ffff:169.254.169.254'];
  const fetch = createRemoteFetch();
  await expect(
    fetch('https://remote.example/mcp', { headers: { authorization: 'fake-remote-token' } }),
  ).rejects.toMatchObject({ code: 'PRIVATE_NETWORK' });
  expect(fixtures.requests).toEqual([]);
});

it('retains domain-owned DNS errors without creating a request', async () => {
  fixtures.addresses = [];
  await expect(createRemoteFetch()('https://remote.example/mcp')).rejects.toMatchObject({
    code: 'DNS_FAILED',
    message: '远程地址解析失败。',
  });
  expect(fixtures.requests).toEqual([]);
});

it('does not extend the exact host fixture exception to another origin', async () => {
  const fetch = createRemoteFetch({ fixtureOrigin: 'http://127.0.0.1:4901' });
  expect(await (await fetch('http://127.0.0.1:4901/mcp')).text()).toBe('Remote fixture');
  await expect(fetch('http://127.0.0.1:4902/mcp')).rejects.toMatchObject({ code: 'INVALID_URL' });
  expect(fixtures.requests).toHaveLength(1);
});

it('creates no socket when the remote request has already been cancelled', async () => {
  const controller = new AbortController();
  const reason = new Error('Remote request stopped');
  controller.abort(reason);
  await expect(
    createRemoteFetch({ signal: controller.signal })('https://remote.example/mcp'),
  ).rejects.toBe(reason);
  expect(fixtures.requests).toEqual([]);
});
