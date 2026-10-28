import { EventEmitter } from 'node:events';
import { IncomingMessage, type RequestOptions } from 'node:http';
import type * as Http from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({
  ipv4: ['100.12.0.13'],
  ipv6: ['::ffff:100.12.0.13'],
  cancellations: 0,
  requests: [] as { url: URL; options: RequestOptions; body: Buffer | undefined }[],
  responses: [] as Record<string, unknown>[],
}));

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    public resolve4(): Promise<string[]> {
      return Promise.resolve(network.ipv4);
    }
    public resolve6(): Promise<string[]> {
      return Promise.resolve(network.ipv6);
    }
    public cancel(): void {
      network.cancellations += 1;
    }
  },
}));

function request(
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): EventEmitter & { end(body?: Buffer): void } {
  return Object.assign(new EventEmitter(), {
    end(body?: Buffer): void {
      network.requests.push({ url, options, body });
      const fixture = network.responses.shift();
      if (fixture === undefined) throw new Error('Missing OAuth HTTP response');
      const response = new IncomingMessage(new Socket());
      response.statusCode = 200;
      response.headers = { 'content-type': 'application/json' };
      queueMicrotask(() => {
        callback(response);
        if (!response.destroyed) {
          response.push(Buffer.from(JSON.stringify(fixture)));
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

const { beginPluginOAuth, pluginOAuthFetch } = await import('../src/plugins/oauth.js');
const { pluginConnectionDefinition } = await import('../src/plugins/connections.js');

beforeEach(() => {
  network.ipv4 = ['100.12.0.13'];
  network.ipv6 = ['::ffff:100.12.0.13'];
  network.cancellations = 0;
  network.requests = [];
  network.responses = [
    { access_token: 'synthetic-mapped-network-token', token_type: 'bearer' },
    { id: 123, login: 'mapped-network-fixture', name: 'Mapped network fixture' },
  ];
});

async function authorize() {
  const flow = await beginPluginOAuth(
    pluginConnectionDefinition('github'),
    {
      clientId: 'synthetic-mapped-client',
      clientSecret: 'synthetic-mapped-secret',
      callbackUrl: 'http://127.0.0.1:4311/api/skill-connections/github/oauth/callback',
    },
    pluginOAuthFetch(),
  );
  return await flow.complete(
    new URLSearchParams({ state: flow.state, code: 'synthetic-mapped-code' }),
    new AbortController().signal,
  );
}

it.each(['::ffff:100.12.0.13', '::ffff:640c:d', '::FFFF:640C:D'])(
  'exchanges GitHub credentials and reads the account with a public mapped AAAA %s',
  async (address) => {
    network.ipv6 = [address];
    const credential = await authorize();
    expect(credential.account?.username).toBe('mapped-network-fixture');
    expect(network.requests.map((entry) => entry.url.href)).toEqual([
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ]);
    for (const entry of network.requests) {
      expect(entry.options.agent).toBe(false);
      const callback = vi.fn();
      entry.options.lookup?.(entry.url.hostname, {}, callback);
      expect(callback).toHaveBeenCalledWith(null, '100.12.0.13', 4);
    }
    const body = network.requests[0]?.body;
    if (body === undefined) throw new Error('Missing token exchange body');
    expect(new URLSearchParams(body.toString()).get('code')).toBe('synthetic-mapped-code');
    expect(network.requests[1]?.options.headers).toMatchObject({
      authorization: 'Bearer synthetic-mapped-network-token',
    });
    expect(network.cancellations).toBe(2);
  },
);

it.each([
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:10.1.2.3',
  '::ffff:169.254.169.254',
  '::ffff:a9fe:a9fe',
  '::ffff:100.64.0.1',
  '::ffff:198.18.0.1',
  '::ffff:0:8.8.8.8',
])(
  'rejects mixed public A and non-public AAAA %s before sending any credentials',
  async (address) => {
    network.ipv6 = [address];
    await expect(authorize()).rejects.toMatchObject({
      code: 'SKILL_OAUTH_FAILED',
      phase: 'token-exchange',
      reason: 'private-network',
    });
    expect(network.requests).toHaveLength(0);
  },
);
