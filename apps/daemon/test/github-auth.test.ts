import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubIdentityProvider } from '../src/auth/github-provider.js';
import { LoginService } from '../src/auth/login-service.js';
import type { IdentityProvider } from '../src/auth/identity-provider.js';
import type { VerifiedIdentity } from '@my-pi-harness/storage';

vi.mock('node:timers/promises', () => ({
  setTimeout(
    milliseconds: number,
    value: undefined,
    options: { signal: AbortSignal },
  ): Promise<undefined> {
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const abort = (): void => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      }, milliseconds);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  },
}));

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn<typeof fetch>((input, init) => {
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    return Promise.resolve(handler(url, init));
  });
}

function requestFields(init: RequestInit | undefined): URLSearchParams {
  if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected form fields');
  return init.body;
}

const DEVICE = {
  device_code: 'private-device-code',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device',
  expires_in: 60,
  interval: 1,
};
const USER = {
  id: 12345,
  login: 'original-name',
  name: 'Display Name',
  avatar_url: 'https://avatars.githubusercontent.com/u/12345',
};
const IDENTITY: VerifiedIdentity = {
  providerId: 'github',
  issuer: 'https://github.com',
  subject: '12345',
  name: 'Display Name',
  avatarUrl: USER.avatar_url,
};

afterEach(() => vi.useRealTimers());

describe('GitHub identity verification', () => {
  it('keeps the authorization issuer separate from the stable application identity issuer', async () => {
    const request = fakeFetch((url) => {
      if (url.endsWith('/access_token'))
        return Response.json({ access_token: 'synthetic-github-token' });
      return Response.json(USER);
    });
    const provider = new GitHubIdentityProvider('test-client', request, 'synthetic-client-secret');
    const challenge = provider.beginWeb(
      'http://127.0.0.1/api/auth/callback/github',
      'synthetic-state',
      new AbortController().signal,
    );
    expect(challenge.authorizationIssuer).toBe('https://github.com/login/oauth');
    expect(new URL(challenge.url).searchParams.get('prompt')).toBe('select_account');
    const identity = await challenge.complete('synthetic-code', new AbortController().signal);
    expect(identity).toEqual(IDENTITY);
    expect(identity.issuer).toBe('https://github.com');
  });

  it('uses the device grant, respects pending/slow_down, and returns a stable subject without credentials', async () => {
    vi.useFakeTimers();
    let polls = 0;
    const request = fakeFetch((url, init) => {
      if (url.endsWith('/device/code')) {
        expect(requestFields(init).get('scope')).toBe('read:user');
        expect(requestFields(init).has('client_secret')).toBe(false);
        return Response.json(DEVICE);
      }
      if (url.endsWith('/access_token')) {
        const fields = requestFields(init);
        expect(fields.get('device_code')).toBe(DEVICE.device_code);
        expect(fields.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
        polls += 1;
        if (polls === 1) return Response.json({ error: 'authorization_pending' });
        if (polls === 2) return Response.json({ error: 'slow_down' });
        return Response.json({ access_token: 'synthetic-github-token' });
      }
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-github-token' });
      return Response.json(USER);
    });
    const provider = new GitHubIdentityProvider('test-client', request);
    const challenge = await provider.begin(new AbortController().signal);
    expect(JSON.stringify(challenge)).not.toContain(DEVICE.device_code);
    const verified = challenge.verify(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(polls).toBe(2);
    await vi.advanceTimersByTimeAsync(5999);
    expect(polls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    const identity = await verified;
    expect(identity).toEqual(IDENTITY);
    expect(JSON.stringify(identity)).not.toContain('synthetic-github-token');
  });

  it.each(['access_denied', 'expired_token', 'incorrect_client_credentials'])(
    'rejects %s without looking up a user',
    async (error) => {
      vi.useFakeTimers();
      const request = fakeFetch((url) => {
        if (url.endsWith('/device/code')) return Response.json(DEVICE);
        return Response.json({ error });
      });
      const provider = new GitHubIdentityProvider('test-client', request);
      const challenge = await provider.begin(new AbortController().signal);
      const result = expect(challenge.verify(new AbortController().signal)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(1000);
      await result;
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it('cancels polling and rejects expired authorization without an identity request', async () => {
    vi.useFakeTimers();
    const request = fakeFetch(() => Response.json({ ...DEVICE, expires_in: 1 }));
    const provider = new GitHubIdentityProvider('test-client', request);
    const challenge = await provider.begin(new AbortController().signal);
    const controller = new AbortController();
    const cancelled = expect(challenge.verify(controller.signal)).rejects.toThrow();
    controller.abort();
    await cancelled;
    const expired = expect(challenge.verify(new AbortController().signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await expired;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://github.com.evil.example/login/device',
    'http://github.com/login/device',
    'https://github.com/login/device?next=evil',
  ])('rejects a forged verification URL %s', async (verification_uri) => {
    const provider = new GitHubIdentityProvider(
      'test-client',
      fakeFetch(() => Response.json({ ...DEVICE, verification_uri })),
    );
    await expect(provider.begin(new AbortController().signal)).rejects.toThrow('无效');
  });

  it('rejects an invalid identity and bounds upstream JSON', async () => {
    vi.useFakeTimers();
    const provider = new GitHubIdentityProvider(
      'test-client',
      fakeFetch((url) => {
        if (url.endsWith('/device/code')) return Response.json(DEVICE);
        if (url.endsWith('/access_token')) return Response.json({ access_token: 'synthetic' });
        return Response.json({ ...USER, id: 'mutable-name' });
      }),
    );
    const challenge = await provider.begin(new AbortController().signal);
    const invalid = expect(challenge.verify(new AbortController().signal)).rejects.toThrow('无效');
    await vi.advanceTimersByTimeAsync(1000);
    await invalid;
    const oversized = new GitHubIdentityProvider(
      'test-client',
      fakeFetch(() => Response.json({ data: 'x'.repeat(70 * 1024) })),
    );
    await expect(oversized.begin(new AbortController().signal)).rejects.toThrow('无效');
  });
});

describe('client-bound application login flows', () => {
  it('limits in-flight requests, hides another client flow and consumes identity once', async () => {
    let resolveIdentity: (identity: VerifiedIdentity) => void = () => undefined;
    const verification = new Promise<VerifiedIdentity>((resolve) => {
      resolveIdentity = resolve;
    });
    const provider: IdentityProvider = {
      id: 'github',
      name: 'GitHub',
      available: true,
      methods: ['device'],
      begin() {
        return Promise.resolve({
          url: DEVICE.verification_uri,
          userCode: DEVICE.user_code,
          expiresAt: Date.now() + 60_000,
          verify: () => verification,
        });
      },
    };
    const service = new LoginService([provider]);
    try {
      const flow = await service.start('client-a', 'github');
      await expect(service.start('client-a', 'github')).rejects.toThrow('已有登录');
      expect(() => service.get('client-b', flow.id)).toThrow('不属于');
      expect(() => service.consume('client-a', flow.id)).toThrow('尚未完成');
      resolveIdentity(IDENTITY);
      await expect.poll(() => service.get('client-a', flow.id).status).toBe('completed');
      expect(service.consume('client-a', flow.id)).toEqual(IDENTITY);
      expect(() => service.consume('client-a', flow.id)).toThrow('已使用');
    } finally {
      resolveIdentity(IDENTITY);
      await service.close();
    }
  });

  it('does not accept a late identity after logout or shutdown', async () => {
    let resolveIdentity: (identity: VerifiedIdentity) => void = () => undefined;
    const verification = new Promise<VerifiedIdentity>((resolve) => {
      resolveIdentity = resolve;
    });
    const service = new LoginService([
      {
        id: 'github',
        name: 'GitHub',
        available: true,
        methods: ['device'],
        begin() {
          return Promise.resolve({
            url: DEVICE.verification_uri,
            userCode: DEVICE.user_code,
            expiresAt: Date.now() + 60_000,
            verify: () => verification,
          });
        },
      },
    ]);
    const flow = await service.start('client-a', 'github');
    const cancelling = service.cancelClient('client-a');
    resolveIdentity(IDENTITY);
    await cancelling;
    expect(service.get('client-a', flow.id).status).toBe('cancelled');
    expect(() => service.consume('client-a', flow.id)).toThrow('尚未完成');
    await service.close();
    await expect(service.start('client-a', 'github')).rejects.toThrow('关闭');
  });
});
