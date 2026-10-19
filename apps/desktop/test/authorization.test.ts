import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopAuthorization } from '../src/main/authorization.js';

const desktop = vi.hoisted(() => ({
  getCookies:
    vi.fn<(filter: { url: string; name?: string }) => Promise<{ name: string; value: string }[]>>(),
  setCookie: vi.fn<(cookie: Record<string, unknown>) => Promise<void>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock('electron', () => ({
  session: { defaultSession: { cookies: { get: desktop.getCookies, set: desktop.setCookie } } },
  shell: { openExternal: desktop.openExternal },
}));

const servers: Server[] = [];

async function serve(
  respond: (request: IncomingMessage) => { status?: number; cookie?: string; body: unknown },
): Promise<string> {
  const server = createServer((request, response) => {
    const result = respond(request);
    response.writeHead(result.status ?? 200, {
      'Content-Type': 'application/json',
      ...(result.cookie === undefined ? {} : { 'Set-Cookie': result.cookie }),
    });
    response.end(JSON.stringify(result.body));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No server address');
  return `http://127.0.0.1:${address.port}`;
}

function bootstrap(): { cookie: string; body: unknown } {
  return {
    cookie: 'my_pi_local=trusted-token; Max-Age=3600; Path=/api; HttpOnly; SameSite=Strict',
    body: { ok: true },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  desktop.getCookies.mockResolvedValue([]);
  desktop.setCookie.mockResolvedValue();
  desktop.openExternal.mockResolvedValue();
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    }),
  );
});

describe('desktop authorization ownership', () => {
  it('reuses local trust without replacing an existing application session', async () => {
    let cookie: string | undefined;
    const origin = await serve((request) => {
      cookie = request.headers.cookie;
      return bootstrap();
    });
    desktop.getCookies.mockResolvedValue([
      { name: 'my_pi_local', value: 'existing-client' },
      { name: 'my_pi_session', value: 'application-session' },
    ]);
    const before = Date.now() / 1000;
    await createDesktopAuthorization(origin, 'owner').authorizeRenderer('http://127.0.0.1:5174/');
    expect(cookie).toBe('my_pi_local=existing-client');
    expect(desktop.getCookies).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:5174/api/auth/status',
      name: 'my_pi_local',
    });
    expect(desktop.setCookie).toHaveBeenCalledOnce();
    expect(desktop.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my_pi_local',
        value: 'trusted-token',
        path: '/api',
        httpOnly: true,
        sameSite: 'strict',
      }),
    );
    const saved = desktop.setCookie.mock.calls[0]?.[0];
    expect(saved?.['expirationDate']).toBeGreaterThanOrEqual(before + 3600);
    expect(saved?.['expirationDate']).toBeLessThan(before + 3602);
  });

  it.each(['login_test-flow', 'auth_test-flow'])(
    'opens %s using current renderer cookies rather than a startup snapshot',
    async (flowId) => {
      const requests: { path: string | undefined; cookie: string | undefined }[] = [];
      const origin = await serve((request) => {
        requests.push({ path: request.url, cookie: request.headers.cookie });
        if (request.url === '/api/auth/desktop') return bootstrap();
        const flow = {
          id: flowId,
          providerId: 'github',
          status: 'pending',
          url: 'https://github.com/login/device',
          deviceCode: 'ABCD-EFGH',
          expiresAt: Date.now() + 60_000,
          error: null,
        };
        if (flowId.startsWith('login_')) return { body: flow };
        return {
          body: {
            id: flowId,
            providerId: 'github',
            status: 'pending',
            url: flow.url,
            deviceCode: null,
            prompt: null,
            message: null,
            error: null,
          },
        };
      });
      const auth = createDesktopAuthorization(origin, 'owner');
      await auth.authorizeRenderer('http://127.0.0.1:5174/');
      desktop.getCookies.mockResolvedValue([
        { name: 'my_pi_local', value: 'trusted-token' },
        { name: 'my_pi_session', value: 'fresh-application-session' },
        { name: 'unrelated', value: 'do-not-forward' },
      ]);
      await auth.openAuth(flowId);
      const expectedPath = flowId.startsWith('login_')
        ? '/api/auth/login-flows/'
        : '/api/auth-flows/';
      expect(requests.at(-1)).toEqual({
        path: expectedPath + flowId,
        cookie: 'my_pi_local=trusted-token; my_pi_session=fresh-application-session',
      });
      expect(desktop.openExternal).toHaveBeenCalledWith('https://github.com/login/device');
    },
  );

  it.each([
    ['completed', 'https://github.com/login/device'],
    ['pending', 'http://github.com/login/device'],
    ['pending', 'https://user:secret@github.com/login/device'],
  ])('rejects %s or uncontrolled authorization address %s', async (status, url) => {
    const origin = await serve((request) => {
      if (request.url === '/api/auth/desktop') return bootstrap();
      return {
        body: {
          id: 'login_test-flow',
          providerId: 'github',
          status,
          url,
          deviceCode: null,
          expiresAt: Date.now() + 60_000,
          error: null,
        },
      };
    });
    const auth = createDesktopAuthorization(origin, 'owner');
    await expect(auth.openAuth('login_test-flow')).rejects.toThrow('桌面尚未授权');
    await auth.authorizeRenderer(origin);
    await expect(auth.openAuth('login_test-flow')).rejects.toThrow();
    expect(desktop.openExternal).not.toHaveBeenCalled();
  });
});
