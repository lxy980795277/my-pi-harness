import { describe, expect, it, vi } from 'vitest';
import { GitHubAuth } from '../src/features/auth/github-auth.js';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn<typeof fetch>((input, init) =>
    Promise.resolve(
      handler(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        init,
      ),
    ),
  );
}

describe('optional GitHub application identity', () => {
  it('binds state and S256 PKCE, consumes the callback once and keeps tokens out of public identity', async () => {
    const identified = vi.fn();
    let exchanged: URLSearchParams | undefined;
    const auth = new GitHubAuth({
      clientId: 'test-client',
      clientSecret: 'synthetic-client-secret',
      onIdentity: identified,
      fetch: fakeFetch((url, init) => {
        if (url.endsWith('/access_token')) {
          exchanged = new URLSearchParams(
            init?.body instanceof URLSearchParams ? init.body.toString() : '',
          );
          return Response.json({ access_token: 'synthetic-private-token' });
        }
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-private-token' });
        return Response.json({
          login: 'test-person',
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
        });
      }),
    });
    const redirect = new URL(auth.startWeb('http://127.0.0.1:4311'));
    const state = redirect.searchParams.get('state');
    if (!state) throw new Error('Missing state');
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirect.searchParams.get('code_challenge')).toHaveLength(43);
    await expect(auth.finishWeb('wrong-state', 'code')).rejects.toThrow('AUTH_STATE_INVALID');
    await auth.finishWeb(state, 'opaque-code');
    expect(exchanged?.get('code_verifier')).toHaveLength(43);
    expect(exchanged?.get('redirect_uri')).toBe('http://127.0.0.1:4311/api/auth/github/callback');
    expect(identified).toHaveBeenCalledWith({
      name: 'test-person',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    });
    expect(JSON.stringify(identified.mock.calls)).not.toContain('synthetic-private-token');
    await expect(auth.finishWeb(state, 'code')).rejects.toThrow('AUTH_STATE_INVALID');
    await auth.close();
  });

  it('implements the device grant and can cancel its polling without identifying the user', async () => {
    const identified = vi.fn();
    const auth = new GitHubAuth({
      clientId: 'test-client',
      clientSecret: 'synthetic-client-secret',
      onIdentity: identified,
      fetch: fakeFetch((url) =>
        url.endsWith('/device/code')
          ? Response.json({
              device_code: 'device-private',
              user_code: 'ABCD-EFGH',
              verification_uri: 'https://github.com/login/device',
              expires_in: 60,
              interval: 1,
            })
          : Response.json({ access_token: 'synthetic-private-token' }),
      ),
    });
    const flow = await auth.startDevice();
    expect(flow.deviceCode).toBe('ABCD-EFGH');
    expect(JSON.stringify(flow)).not.toContain('device-private');
    expect(auth.cancel(flow.id).status).toBe('cancelled');
    await auth.close();
    expect(identified).not.toHaveBeenCalled();
  });

  it('completes device polling and rejects a forged verification domain', async () => {
    const identified = vi.fn();
    const auth = new GitHubAuth({
      clientId: 'test-client',
      clientSecret: 'synthetic-client-secret',
      onIdentity: identified,
      fetch: fakeFetch((url, init) => {
        if (url.endsWith('/device/code'))
          return Response.json({
            device_code: 'device-private',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://github.com/login/device',
            expires_in: 60,
            interval: 1,
          });
        if (url.endsWith('/access_token')) {
          const body = new URLSearchParams(
            init?.body instanceof URLSearchParams ? init.body.toString() : '',
          );
          expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
          expect(body.has('code_verifier')).toBe(false);
          return Response.json({ access_token: 'synthetic-private-token' });
        }
        return Response.json({
          login: 'device-person',
          avatar_url: 'https://avatars.githubusercontent.com/u/2',
        });
      }),
    });
    const flow = await auth.startDevice();
    await expect.poll(() => auth.get(flow.id).status).toBe('completed');
    expect(identified).toHaveBeenCalledOnce();
    await auth.close();
    const forged = new GitHubAuth({
      clientId: 'test-client',
      clientSecret: 'synthetic-client-secret',
      onIdentity: identified,
      fetch: fakeFetch(() =>
        Response.json({
          device_code: 'private',
          user_code: 'ABCD',
          verification_uri: 'https://github.com.evil.example/login/device',
          expires_in: 60,
          interval: 1,
        }),
      ),
    });
    await expect(forged.startDevice()).rejects.toThrow('AUTH_DEVICE_INVALID');
    await forged.close();
  });
});
