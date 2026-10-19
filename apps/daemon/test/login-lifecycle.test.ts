import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { openProfileStore, type VerifiedIdentity } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IdentityChallenge,
  IdentityProvider,
} from '../src/features/auth/identity-provider.js';
import { LocalAuth } from '../src/features/auth/local-auth.js';
import { LoginService, loginCallbackNonce } from '../src/features/auth/login-service.js';

const identity: VerifiedIdentity = {
  providerId: 'github',
  issuer: 'https://github.com',
  subject: '42424242',
  name: 'Fixture User',
  avatarUrl: null,
};

function deferred() {
  let complete: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(): void {
      if (!complete) throw new Error('Deferred fixture has no resolver');
      complete();
    },
  };
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('login verification task ownership', () => {
  it.each(['logout', 'close'])(
    'owns a replacement Web start while its predecessor drains, so %s cannot miss it',
    async (operation) => {
      const entered = deferred();
      const released = deferred();
      let challenges = 0;
      const provider: IdentityProvider = {
        id: 'github',
        name: 'GitHub',
        available: true,
        methods: ['web'],
        beginWeb(callbackUrl, state) {
          challenges += 1;
          const url = new URL('https://identity.example/authorize');
          url.searchParams.set('state', state);
          url.searchParams.set('redirect_uri', callbackUrl);
          return {
            url: url.href,
            authorizationIssuer: 'https://identity.example',
            expiresAt: Date.now() + 60_000,
            async complete() {
              entered.resolve();
              await released.promise;
              return identity;
            },
          };
        },
      };
      const service = new LoginService([provider]);
      const callbackUrl = 'http://127.0.0.1/api/auth/callback/github';
      const origin = 'http://127.0.0.1';
      let returning: Promise<string> | undefined;
      let stopping: Promise<void> | undefined;
      let rejected: Promise<void> | undefined;
      try {
        const first = await service.startWeb('client', provider.id, callbackUrl, origin);
        const state = new URL(first.flow.url ?? '').searchParams.get('state');
        if (!state) throw new Error('Missing state');
        returning = service.completeWeb(
          provider.id,
          state,
          loginCallbackNonce(first.cookie),
          'code',
          undefined,
        );
        await entered.promise;
        const replacement = service.startWeb('client', provider.id, callbackUrl, origin);
        let code = 'LOGIN_CANCELLED';
        if (operation === 'close') code = 'LOGIN_CLOSED';
        rejected = expect(replacement).rejects.toMatchObject({ code });
        let finished = false;
        stopping = (async () => {
          if (operation === 'close') await service.close();
          else await service.cancelClient('client');
          finished = true;
        })();
        await Promise.resolve();
        await Promise.resolve();
        expect(finished).toBe(false);
        expect(challenges).toBe(1);
        released.resolve();
        await Promise.all([returning, stopping, rejected]);
        expect(finished).toBe(true);
        expect(challenges).toBe(1);
        expect(() => service.consume('client', first.flow.id)).toThrow();
      } finally {
        released.resolve();
        await Promise.allSettled([returning, stopping, rejected]);
        await service.close();
      }
    },
  );

  it('supports a Web-only identity source without a stub device handler or GitHub-specific denial', async () => {
    const provider: IdentityProvider = {
      id: 'web-only',
      name: 'Web-only',
      available: true,
      methods: ['web'],
      beginWeb(callbackUrl, state) {
        const url = new URL('https://identity.example/authorize');
        url.searchParams.set('state', state);
        url.searchParams.set('redirect_uri', callbackUrl);
        return {
          url: url.href,
          authorizationIssuer: 'https://identity.example',
          expiresAt: Date.now() + 60_000,
          complete: () => Promise.resolve({ ...identity, providerId: 'web-only' }),
        };
      },
    };
    const service = new LoginService([provider]);
    try {
      await expect(service.start('client', provider.id)).rejects.toMatchObject({
        code: 'LOGIN_METHOD_UNAVAILABLE',
      });
      const started = await service.startWeb(
        'client',
        provider.id,
        'http://127.0.0.1/api/auth/callback/web-only',
        'http://127.0.0.1',
      );
      const state = new URL(started.flow.url ?? '').searchParams.get('state');
      if (!state) throw new Error('Missing state');
      await service.completeWeb(
        provider.id,
        state,
        loginCallbackNonce(started.cookie),
        undefined,
        'access_denied',
      );
      expect(service.get('client', started.flow.id).error).toBe('授权已被拒绝，请重试。');
      const next = await service.startWeb(
        'client',
        provider.id,
        'http://127.0.0.1/api/auth/callback/web-only',
        'http://127.0.0.1',
      );
      const nextState = new URL(next.flow.url ?? '').searchParams.get('state');
      if (!nextState) throw new Error('Missing state');
      await service.completeWeb(
        provider.id,
        nextState,
        loginCallbackNonce(next.cookie),
        'code',
        undefined,
      );
      expect(service.consume('client', next.flow.id).providerId).toBe('web-only');
    } finally {
      await service.close();
    }
  });

  it.each([
    ['active', 'close'],
    ['expired-pruned', 'close'],
    ['active', 'logout'],
    ['expired-pruned', 'logout'],
  ])(
    'waits for an aborted %s verification to release its resources before %s completes',
    async (state, operation) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1000);
      const released = deferred();
      const aborted = deferred();
      let requests = 0;
      const provider: IdentityProvider = {
        id: 'github',
        name: 'GitHub',
        available: true,
        methods: ['device'],
        begin(): Promise<IdentityChallenge> {
          requests += 1;
          const first = requests === 1;
          return Promise.resolve({
            url: 'https://github.com/login/device',
            userCode: 'FIXTURE-CODE',
            expiresAt: Date.now() + 1000,
            async verify(signal) {
              if (!first) return identity;
              signal.addEventListener('abort', () => aborted.resolve(), { once: true });
              await released.promise;
              return identity;
            },
          });
        },
      };
      const service = new LoginService([provider]);
      let closing: Promise<void> | undefined;
      try {
        const first = await service.start('client', 'github');
        if (state === 'expired-pruned') {
          vi.setSystemTime(2001);
          await service.start('client', 'github');
          await aborted.promise;
          expect(() => service.get('client', first.id)).toThrow(
            expect.objectContaining({ code: 'LOGIN_NOT_FOUND' }),
          );
        }
        let closed = false;
        closing = (async () => {
          if (operation === 'close') await service.close();
          else await service.cancelClient('client');
          closed = true;
        })();
        await aborted.promise;
        await Promise.resolve();
        await Promise.resolve();
        expect(closed).toBe(false);
        released.resolve();
        await closing;
        expect(closed).toBe(true);
        expect(() => service.consume('client', first.id)).toThrow();
        if (operation === 'close')
          await expect(service.start('client', 'github')).rejects.toMatchObject({
            code: 'LOGIN_CLOSED',
          });
      } finally {
        released.resolve();
        if (closing) await closing;
        await service.close();
      }
    },
  );

  it('permits repeated completed logins without exhausting the in-flight flow limit', async () => {
    const provider: IdentityProvider = {
      id: 'github',
      name: 'GitHub',
      available: true,
      methods: ['device'],
      begin: () =>
        Promise.resolve({
          url: 'https://github.com/login/device',
          userCode: 'FIXTURE-CODE',
          expiresAt: Date.now() + 60_000,
          verify: () => Promise.resolve(identity),
        }),
    };
    const service = new LoginService([provider]);
    try {
      for (let index = 0; index < 40; index += 1) {
        const flow = await service.start('client', 'github');
        expect(service.get('client', flow.id).status).toBe('completed');
        expect(service.consume('client', flow.id)).toEqual(identity);
        expect(() => service.consume('client', flow.id)).toThrow(
          expect.objectContaining({ code: 'LOGIN_NOT_READY' }),
        );
      }
    } finally {
      await service.close();
    }
  });
});

describe('local authorization watcher lifetime', () => {
  it.each(['close', 'expire'])(
    'releases the expiry timer on %s and never accesses a closed profile',
    async (action) => {
      const directory = await mkdtemp(join(tmpdir(), 'my-pi-login-watch-'));
      const store = await openProfileStore(directory);
      const server = Fastify();
      const auth = new LocalAuth({ store: store.auth, providers: () => [] });
      let stopWatch = (): void => undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(1000);
        const localToken = randomBytes(32).toString('base64url');
        const loginToken = randomBytes(32).toString('base64url');
        store.auth.createLocalClient({
          id: 'client',
          tokenHash: hash(localToken),
          csrfToken: 'csrf-fixture',
          createdAt: 1000,
          expiresAt: 10_000,
        });
        store.auth.completeLogin(identity, 'client', {
          id: 'session',
          tokenHash: hash(loginToken),
          createdAt: 1000,
          expiresAt: 2000,
        });
        const readSession = vi.spyOn(store.auth, 'findLoginSession');
        const lost = vi.fn<() => void>();
        server.get('/watch', (request) => {
          stopWatch = auth.watch(request, lost);
          return { ok: true };
        });
        const response = await server.inject({
          url: '/watch',
          headers: { Cookie: `my_pi_local=${localToken}; my_pi_session=${loginToken}` },
        });
        expect(response.statusCode).toBe(200);
        expect(readSession).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
        if (action === 'expire') {
          await vi.advanceTimersByTimeAsync(1001);
          expect(lost).toHaveBeenCalledTimes(1);
        } else {
          auth.close();
          auth.close();
          expect(lost).not.toHaveBeenCalled();
        }
        expect(vi.getTimerCount()).toBe(0);
        const previousReads = readSession.mock.calls.length;
        store.close();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(readSession).toHaveBeenCalledTimes(previousReads);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        stopWatch();
        auth.close();
        store.close();
        vi.useRealTimers();
        await server.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
