import { QueryClient } from '@tanstack/react-query';
import type { AuthStatus, LoginFlow } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeLogin,
  createPairingCode,
  fetchAuthStatus,
  logoutBrowser,
  startLogin,
} from '../src/features/auth/services/auth';
import {
  discardLoginFlow,
  finishLoginFlow,
  githubLoginUrl,
  githubWebLoginUrl,
  isDefinitiveLoginRejection,
  restoreLoginFlow,
} from '../src/features/auth/utils/login-flow';
import { loginEntry, readLoginCallback } from '../src/features/auth/utils/login-entry';
import { clearPrivateCache } from '../src/features/auth/utils/private-cache';
import {
  AUTH_STATUS_QUERY_KEY,
  createAuthorizationStatus,
} from '../src/features/auth/utils/authorization-status';
import { HEALTH_QUERY_KEY } from '../src/features/runtime/queries/health';
import { hasValidApplicationSession } from '../src/features/auth/utils/application-session';
import { getUserProfile } from '../src/app/utils/user-profile';
import {
  RequestError,
  getJson,
  setCsrfToken,
  subscribeAuthorizationLoss,
} from '../src/services/base-request';

const flow = (status: LoginFlow['status'] = 'pending'): LoginFlow => {
  return {
    id: 'login_test',
    providerId: 'github',
    status,
    url: 'https://github.com/login/device',
    deviceCode: 'ABCD-EFGH',
    expiresAt: Date.now() + 60_000,
    error: null,
  };
};
const authenticated: AuthStatus = {
  localAuthorized: true,
  authenticated: true,
  csrfToken: 'local-csrf',
  profileBound: true,
  providers: [{ id: 'github', name: 'GitHub', available: true, methods: ['device', 'web'] }],
  user: { id: 'user-1', name: 'Xinyu', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
  session: { id: 'session-1', providerId: 'github', expiresAt: 9_000_000_000_000 },
};
const response = (body: unknown): Response => {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('application login transport', () => {
  it('does not replace the CSRF token with a cancelled authorization response', async () => {
    const delayed = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(response({ code: 'one-time-code' }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('current-csrf');
    const controller = new AbortController();
    const pending = fetchAuthStatus(controller.signal);
    const cancelled = expect(pending).rejects.toThrow();
    controller.abort();
    delayed.resolve(response(authenticated));
    await cancelled;
    await createPairingCode(new AbortController().signal);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      headers: { 'X-CSRF-Token': 'current-csrf' },
    });
  });

  it('uses separate login endpoints and installs only the public CSRF token', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(flow()))
      .mockResolvedValueOnce(response(authenticated))
      .mockResolvedValueOnce(response({ code: 'one-time-code' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('trusted-csrf');
    const signal = new AbortController().signal;
    await startLogin('github', 'web', signal);
    await completeLogin('login_test', signal);
    expect(await createPairingCode(signal)).toBe('one-time-code');
    await logoutBrowser(signal);
    expect(
      fetch.mock.calls.map(([path]) => {
        return path;
      }),
    ).toEqual([
      '/api/auth/login',
      '/api/auth/login-flows/login_test/complete',
      '/api/auth/pairing-code',
      '/api/auth/logout',
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"providerId":"github","method":"web"}',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'trusted-csrf' },
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: '{}',
      headers: { 'X-CSRF-Token': 'local-csrf' },
    });
    // Local trust and its CSRF token remain available for the next login after logout.
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({ headers: { 'X-CSRF-Token': 'local-csrf' } });
  });

  it('rejects a legacy model flow and reports a protected 401 to the authorization owner', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ ...flow(), id: 'provider-flow', prompt: null }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: '请重新登录' }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(startLogin('github', 'device', signal)).rejects.toThrow();
    const lost = vi.fn();
    const unsubscribe = subscribeAuthorizationLoss(lost);
    try {
      await expect(getJson('/sessions', signal)).rejects.toThrow('请重新登录');
      expect(lost).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});

describe('view-owned login completion', () => {
  it('restores a Web callback through cookie-authenticated reads and completes it once', async () => {
    const completed = { ...flow('completed'), url: null, deviceCode: null };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ ...authenticated, authenticated: false, user: null, session: null }),
      )
      .mockResolvedValueOnce(response(completed))
      .mockResolvedValueOnce(response(authenticated));
    vi.stubGlobal('fetch', fetch);
    const receive = vi.fn();
    const status = await restoreLoginFlow('login_test', receive, new AbortController().signal);
    expect(status).toEqual(authenticated);
    expect(receive).toHaveBeenCalledExactlyOnceWith(completed);
    expect(
      fetch.mock.calls.map(([path]) => {
        return path;
      }),
    ).toEqual([
      '/api/auth/status',
      '/api/auth/login-flows/login_test',
      '/api/auth/login-flows/login_test/complete',
    ]);
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  });

  it('does not replay completion when a callback URL is revisited with a valid session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(authenticated));
    vi.stubGlobal('fetch', fetch);
    const receive = vi.fn();
    expect(await restoreLoginFlow('login_test', receive, new AbortController().signal)).toEqual(
      authenticated,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(receive).not.toHaveBeenCalled();
  });

  it('does not complete a Web callback whose first setup was cancelled', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((): Promise<Response> => {
      controller.abort();
      return Promise.resolve(
        response({ ...authenticated, authenticated: false, user: null, session: null }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    await expect(restoreLoginFlow('login_test', vi.fn(), controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('polls pending status, then completes exactly once', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(flow()))
      .mockResolvedValueOnce(response(flow('completed')))
      .mockResolvedValueOnce(response(authenticated));
    vi.stubGlobal('fetch', fetch);
    const receive = vi.fn();
    const result = finishLoginFlow(flow(), receive, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toEqual(authenticated);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.map(([path]) => {
        return path;
      }),
    ).toEqual([
      '/api/auth/login-flows/login_test',
      '/api/auth/login-flows/login_test',
      '/api/auth/login-flows/login_test/complete',
    ]);
  });

  it('stops an unmounted or cancelled flow before any completion write', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const result = finishLoginFlow(flow(), vi.fn(), controller.signal);
    const rejected = expect(result).rejects.toThrow('登录已取消');
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a completed polling response that arrives after cancellation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const gate: { resolve?: (value: Response) => void } = {};
    const delayed = new Promise<Response>((resolve) => {
      gate.resolve = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(delayed);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const receive = vi.fn();
    const result = finishLoginFlow(flow(), receive, controller.signal);
    const cancelled = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    controller.abort();
    if (!gate.resolve) {
      throw new Error('Missing delayed response resolver');
    }
    gate.resolve(response(flow('completed')));
    await cancelled;
    expect(receive).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit retry after a failed completion instead of looping writes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('service unavailable'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      finishLoginFlow(flow('completed'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow('service unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects expired and provider-rejected flows without a completion write', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    await expect(
      finishLoginFlow(
        { ...flow(), expiresAt: Date.now() - 1 },
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('过期');
    await expect(
      finishLoginFlow(
        { ...flow('failed'), error: 'GitHub 拒绝登录' },
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('GitHub 拒绝登录');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts only the GitHub Device Flow page for application login', () => {
    expect(githubLoginUrl('https://github.com/login/device')).toBe(
      'https://github.com/login/device',
    );
    for (const url of [
      'https://github.com.evil.test/login/device',
      'https://github.com/login/device?redirect=evil',
      'http://github.com/login/device',
      'https://github.com/other',
      'https://user:secret@github.com/login/device',
    ]) {
      expect(() => {
        githubLoginUrl(url);
      }).toThrow();
    }
  });

  it('requires GitHub Web PKCE and a loopback callback before leaving the browser', () => {
    const valid = new URL('https://github.com/login/oauth/authorize');
    valid.search = new URLSearchParams({
      client_id: 'test-client',
      state: 'test-state',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
      scope: 'read:user',
      redirect_uri: 'http://127.0.0.1:5174/api/auth/callback/github',
    }).toString();
    expect(githubWebLoginUrl(valid.href)).toBe(valid.href);
    for (const [key, value] of [
      ['redirect_uri', 'https://evil.test/api/auth/callback/github'],
      ['redirect_uri', 'http://127.0.0.1:5174/other'],
      ['code_challenge_method', 'plain'],
      ['state', ''],
      ['scope', 'repo'],
    ]) {
      const altered = new URL(valid);
      if (key === undefined || value === undefined) {
        throw new Error('Missing URL test case');
      }
      altered.searchParams.set(key, value);
      expect(() => {
        githubWebLoginUrl(altered.href);
      }).toThrow();
    }
    for (const value of [
      valid.href.replace('github.com', 'github.com.evil.test'),
      valid.href.replace('https://', 'http://'),
      `${valid.href}#fragment`,
      'https://github.com/login/device',
    ]) {
      expect(() => {
        githubWebLoginUrl(value);
      }).toThrow();
    }
  });
});

describe('login entry selection and callback navigation', () => {
  it('keeps Web unavailable without its secret while Electron can use the configured device method', () => {
    const status: AuthStatus = {
      ...authenticated,
      providers: [{ id: 'github', name: 'GitHub', available: true, methods: ['device'] }],
    };
    const web = loginEntry(status, false);
    expect(web).toMatchObject({
      method: 'web',
      configured: false,
    });
    expect(web.configurationMessage).toContain('MY_PI_HARNESS_GITHUB_CLIENT_SECRET');
    expect(loginEntry(status, true)).toEqual({
      method: 'device',
      configured: true,
      configurationMessage: null,
    });
    expect(loginEntry(authenticated, false)).toEqual({
      method: 'web',
      configured: true,
      configurationMessage: null,
    });
    expect(loginEntry({ ...status, providers: [] }, false).configurationMessage).toContain('.env');
  });

  it('removes the temporary callback ID without changing unrelated query or fragment state', () => {
    expect(
      readLoginCallback('http://127.0.0.1:5174/?theme=dark&login_flow=login_test#start'),
    ).toEqual({
      flowId: 'login_test',
      cleanUrl: '/?theme=dark#start',
      error: null,
    });
    expect(readLoginCallback('http://127.0.0.1:5174/?theme=dark')).toEqual({
      flowId: null,
      cleanUrl: '/?theme=dark',
      error: null,
    });
    for (const query of [
      'login_flow=../other',
      'login_flow=login_one&login_flow=login_two',
      `login_flow=login_${'x'.repeat(100)}`,
    ]) {
      expect(readLoginCallback(`http://127.0.0.1:5174/?${query}`)).toEqual({
        flowId: null,
        cleanUrl: '/',
        error: '登录回调无效，请重新登录。',
      });
    }
  });
});

describe('authorization recovery decisions', () => {
  it('permits a new flow after the old exchange expired or disappeared', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await discardLoginFlow({ ...flow(), expiresAt: Date.now() - 1 }, signal);
    expect(fetch).not.toHaveBeenCalled();
    await discardLoginFlow(flow(), signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('keeps a known valid session across network failure but refuses expired or revoked data', () => {
    expect(hasValidApplicationSession(authenticated, false, 1_000)).toBe(true);
    expect(hasValidApplicationSession(authenticated, true, 1_000)).toBe(false);
    expect(hasValidApplicationSession(authenticated, false, 9_000_000_000_000)).toBe(false);
    expect(hasValidApplicationSession(undefined, false, 1_000)).toBe(false);
    expect(
      hasValidApplicationSession({ ...authenticated, authenticated: false }, false, 1_000),
    ).toBe(false);
  });

  it('offers a new login after a definite profile rejection, and recovery after unknown transport results', () => {
    expect(
      isDefinitiveLoginRejection(new RequestError('此本机配置已绑定其他GitHub账号', 409)),
    ).toBe(true);
    expect(isDefinitiveLoginRejection(new RequestError('登录流程不存在', 404))).toBe(true);
    expect(isDefinitiveLoginRejection(new TypeError('Failed to fetch'))).toBe(false);
    expect(isDefinitiveLoginRejection(new RequestError('服务不可用', 503))).toBe(false);
  });
});

describe('private application state', () => {
  it('starts a fresh revocation check while an older check is still waiting on the network', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const delayed = Promise.withResolvers<Response>();
    const loggedOut: AuthStatus = {
      ...authenticated,
      authenticated: false,
      user: null,
      session: null,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(response(loggedOut));
    vi.stubGlobal('fetch', fetch);
    const received = vi.fn();
    const owner = createAuthorizationStatus(client, received);
    const signal = new AbortController().signal;
    const pending = owner.refresh(signal);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    const generation = owner.invalidate();
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await owner.refresh(signal, generation);
    delayed.resolve(response(authenticated));
    await pending;
    expect(client.getQueryData(AUTH_STATUS_QUERY_KEY)).toEqual(loggedOut);
    expect(received).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('blocks passive reads during revocation and accepts a subsequent explicit login', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const delayed = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(authenticated))
      .mockReturnValueOnce(delayed.promise);
    vi.stubGlobal('fetch', fetch);
    const received = vi.fn();
    const owner = createAuthorizationStatus(client, received);
    const signal = new AbortController().signal;
    const generation = owner.invalidate();
    await owner.refresh(signal);
    await expect(owner.read(signal)).rejects.toThrow('Authorization transition pending');
    expect(fetch).not.toHaveBeenCalled();
    const signedIn = {
      ...authenticated,
      session: {
        id: 'session-2',
        providerId: 'github',
        expiresAt: 9_000_000_000_000,
      },
    };
    await owner.receive(signedIn, signal);
    await owner.refresh(signal, generation);
    expect(fetch).not.toHaveBeenCalled();
    expect(client.getQueryData(AUTH_STATUS_QUERY_KEY)).toEqual(signedIn);
    expect(await owner.read(signal)).toEqual(authenticated);
    const stale = owner.read(signal);
    const cancelled = expect(stale).rejects.toThrow();
    owner.invalidate();
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    delayed.resolve(response(authenticated));
    await cancelled;
    expect(client.getQueryData(AUTH_STATUS_QUERY_KEY)).toEqual(signedIn);
    expect(received).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('keeps a completed logout after an older authorization check responds', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const delayed = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(delayed.promise);
    vi.stubGlobal('fetch', fetch);
    const received = vi.fn();
    const owner = createAuthorizationStatus(client, received);
    const signal = new AbortController().signal;
    client.setQueryData(AUTH_STATUS_QUERY_KEY, authenticated);
    const pending = owner.refresh(signal);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    const loggedOut: AuthStatus = {
      ...authenticated,
      authenticated: false,
      user: null,
      session: null,
    };
    await owner.receive(loggedOut, signal);
    delayed.resolve(response(authenticated));
    await pending;
    expect(client.getQueryData(AUTH_STATUS_QUERY_KEY)).toEqual(loggedOut);
    expect(received).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('removes private queries and mutations while preserving authorization and public diagnostics', async () => {
    const client = new QueryClient();
    client.setQueryData(AUTH_STATUS_QUERY_KEY, authenticated);
    client.setQueryData(HEALTH_QUERY_KEY, { status: 'ok' });
    client.setQueryData(['runtime', 'private-state'], { sessionId: 'private-session' });
    client.setQueryData(['sessions'], ['private-session']);
    client.setQueryData(['providers'], ['private-provider']);
    client.getMutationCache().build(client, { mutationKey: ['private-write'] });
    await clearPrivateCache(client);
    expect(client.getQueryData(['sessions'])).toBeUndefined();
    expect(client.getQueryData(['providers'])).toBeUndefined();
    expect(client.getQueryData(['runtime', 'private-state'])).toBeUndefined();
    expect(client.getMutationCache().getAll()).toEqual([]);
    expect(client.getQueryData(AUTH_STATUS_QUERY_KEY)).toEqual(authenticated);
    expect(client.getQueryData(HEALTH_QUERY_KEY)).toEqual({ status: 'ok' });
    expect(client.getQueryState(HEALTH_QUERY_KEY)?.isInvalidated).toBe(true);
    client.clear();
  });

  it('cancels a private request before a late result can restore its query', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const gate: { resolve?: (value: string[]) => void } = {};
    const aborted = vi.fn();
    const delayed = new Promise<string[]>((resolve) => {
      gate.resolve = resolve;
    });
    const pending = client.query({
      queryKey: ['sessions'],
      queryFn: ({ signal }): Promise<string[]> => {
        signal.addEventListener('abort', aborted, { once: true });
        return delayed;
      },
    });
    const cancelled = expect(pending).rejects.toThrow();
    await clearPrivateCache(client);
    expect(aborted).toHaveBeenCalledTimes(1);
    if (!gate.resolve) {
      throw new Error('Missing delayed query resolver');
    }
    gate.resolve(['late-private-session']);
    await cancelled;
    expect(client.getQueryData(['sessions'])).toBeUndefined();
    client.clear();
  });

  it('displays the real user and never falls back to a mock identity', () => {
    expect(getUserProfile(authenticated)).toEqual({
      name: 'Xinyu',
      initial: 'X',
      avatarUrl: authenticated.user?.avatarUrl,
    });
    expect(getUserProfile(undefined)).toEqual({ name: '', initial: '', avatarUrl: null });
  });
});
