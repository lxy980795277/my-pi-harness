import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

/** Real loopback provider fixture with fake credentials; requests are never sent to vendors. */
export interface ConnectionUpstream {
  origin: string;
  calls: { path: string; method: string; body: Record<string, unknown>; authorization: string }[];
  dropRefresh(): void;
  failToken(body: Readonly<Record<string, unknown>>, statusCode?: number): void;
  setAccount(id: string): void;
  holdProfile(): Promise<void>;
  releaseProfile(): void;
  close(): Promise<void>;
}
export async function connectionUpstream(): Promise<ConnectionUpstream> {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
    authorization: string;
  }[] = [];
  const sockets = new Set<Socket>();
  let dropRefresh = false;
  let tokenFailure: { body: Readonly<Record<string, unknown>>; statusCode: number } | undefined;
  let accountId: string | undefined;
  let holdProfile = false;
  let profileRelease: (() => void) | undefined;
  let profileEntered: (() => void) | undefined;
  let entered = Promise.resolve();
  let returned = Promise.resolve();
  const server = createServer((request, response) => {
    const handle = async (): Promise<void> => {
      let raw = '';
      for await (const chunk of request) {
        raw += String(chunk);
        if (raw.length > 500000) throw new Error('Fixture request limit');
      }
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        if (request.headers['content-type']?.includes('application/json')) {
          const parsed: unknown = JSON.parse(raw);
          if (!Value.Check(Type.Record(Type.String(), Type.Unknown()), parsed))
            throw new Error('Fixture expects object body');
          body = parsed;
        } else body = Object.fromEntries(new URLSearchParams(raw));
      }
      const url = new URL(request.url ?? '/', 'http://fixture.invalid');
      const path = url.pathname;
      const service = path.split('/')[1];
      calls.push({
        path,
        method: request.method ?? 'GET',
        body,
        authorization: request.headers.authorization ?? '',
      });
      response.setHeader('content-type', 'application/json');
      if (
        path === '/google/token' ||
        path.endsWith('/oauth/token') ||
        path.endsWith('/login/oauth/access_token')
      ) {
        if (tokenFailure !== undefined) {
          response.statusCode = tokenFailure.statusCode;
          response.end(JSON.stringify(tokenFailure.body));
          return;
        }
        if (dropRefresh && body['grant_type'] === 'refresh_token') {
          response.destroy();
          return;
        }
        response.end(
          JSON.stringify({
            access_token: `fixture-${String(service)}-token`,
            token_type: 'Bearer',
            refresh_token: `fixture-${String(service)}-refresh`,
            expires_in: 3600,
            scope: '',
            ...(service === 'google' &&
            String(body['redirect_uri']).includes('/api/skill-connections/google/')
              ? {
                  id_token: `fixture.${Buffer.from(JSON.stringify({ sub: accountId ?? 'google-account', email: 'google.fixture@example.com', name: 'Google fixture', picture: 'https://fixture.example/avatar' })).toString('base64url')}.signature`,
                }
              : {}),
          }),
        );
        return;
      }
      if (isProfile(request, path)) {
        if (holdProfile) {
          profileEntered?.();
          await returned;
        }
        let value: unknown = {
          id: accountId ?? `${String(service)}-account`,
          name: `${String(service)} fixture`,
          login: `${String(service)} fixture`,
        };
        if (service === 'google')
          value = { sub: accountId ?? 'google-account', name: 'Google fixture' };
        if (service === 'vercel')
          value = {
            user: { id: accountId ?? 'vercel-account', username: 'Vercel fixture' },
            sub: accountId ?? 'vercel-account',
            preferred_username: 'Vercel fixture',
            name: 'Vercel fixture',
          };
        response.end(JSON.stringify(value));
        return;
      }

      response.end(
        JSON.stringify({
          fixture: true,
          path,
          body,
          echoAuthorization: request.headers.authorization,
        }),
      );
    };
    handle().catch(() => {
      response.destroy();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No fixture address');
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    calls,
    dropRefresh(): void {
      dropRefresh = true;
    },
    failToken(body, statusCode = 200): void {
      tokenFailure = { body, statusCode };
    },
    setAccount(id: string): void {
      accountId = id;
    },
    holdProfile(): Promise<void> {
      holdProfile = true;
      entered = new Promise<void>((accept) => {
        profileEntered = accept;
      });
      returned = new Promise<void>((accept) => {
        profileRelease = accept;
      });
      return entered;
    },
    releaseProfile(): void {
      holdProfile = false;
      profileRelease?.();
    },
    close: async (): Promise<void> => {
      profileRelease?.();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((accept, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else accept();
        });
      });
    },
  };
}
function isProfile(request: IncomingMessage, path: string): boolean {
  return (
    request.method === 'GET' &&
    (path.endsWith('/user') ||
      path.endsWith('/v2/user') ||
      path.endsWith('/userinfo') ||
      path.endsWith('/users/me') ||
      path.endsWith('/profile'))
  );
}
