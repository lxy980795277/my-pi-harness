import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RemoteOAuthSession } from '../src/remote-oauth.js';

async function fixture() {
  let issuer = '';
  let challenge = '';
  let exchanges = 0;
  let refreshes = 0;
  const failures: unknown[] = [];
  const server = createServer((request, response) => {
    const operation = (async () => {
      const url = new URL(request.url ?? '/', issuer);
      response.setHeader('content-type', 'application/json');
      if (url.pathname.includes('oauth-protected-resource')) {
        response.end(
          JSON.stringify({
            resource: `${issuer}/mcp`,
            authorization_servers: [issuer],
            scopes_supported: ['fixture.read'],
          }),
        );
        return;
      }
      if (
        url.pathname.includes('oauth-authorization-server') ||
        url.pathname.includes('openid-configuration')
      ) {
        response.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            registration_endpoint: `${issuer}/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            authorization_response_iss_parameter_supported: true,
          }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (url.pathname === '/register') {
        response.end(
          JSON.stringify({
            client_id: 'fixture-client',
            redirect_uris: ['http://127.0.0.1/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
        );
        return;
      }
      if (url.pathname === '/token') {
        const params = new URLSearchParams(body);
        if (params.get('grant_type') === 'authorization_code') {
          exchanges += 1;
          const verifier = params.get('code_verifier');
          if (
            verifier === null ||
            createHash('sha256').update(verifier).digest('base64url') !== challenge
          ) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
        } else {
          refreshes += 1;
          expect(params.get('refresh_token')).toBe('fake-refresh');
        }
        response.end(
          JSON.stringify({
            access_token: `fake-token-${exchanges + refreshes}`,
            refresh_token: 'fake-refresh',
            token_type: 'Bearer',
            expires_in: 1,
            scope: 'fixture.read',
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    })();
    operation.catch((error) => {
      failures.push(error);
      response.destroy();
    });
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      accept();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address');
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    challenge: (value: string) => {
      challenge = value;
    },
    exchanges: () => exchanges,
    refreshes: () => refreshes,
    failures,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((accept, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else accept();
        });
      });
    },
  };
}
describe('official MCP OAuth', () => {
  it('uses PKCE, preserves issuer-stamped credentials and refreshes before the next tool request', async () => {
    const remote = await fixture();
    let saved: string | undefined;
    try {
      const session = new RemoteOAuthSession({
        endpoint: `${remote.issuer}/mcp`,
        redirectUrl: 'http://127.0.0.1/callback',
        fixtureOrigin: remote.issuer,
        store: {
          read: () => Promise.resolve(saved),
          write: (value) => {
            saved = value;
            return Promise.resolve();
          },
        },
      });
      await session.initialize();
      const begin = await session.begin(AbortSignal.timeout(3000));
      const authorization = new URL(begin.url);
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorization.searchParams.get('state')).toBe(begin.state);
      const challenge = authorization.searchParams.get('code_challenge');
      if (challenge === null) throw new Error('Missing PKCE challenge');
      remote.challenge(challenge);
      await session.complete(
        new URLSearchParams({ state: begin.state, code: 'fixture-code', iss: remote.issuer }),
        AbortSignal.timeout(3000),
      );
      expect(remote.exchanges()).toBe(1);
      expect(saved).toContain('fake-refresh');
      expect(await session.accessToken(AbortSignal.timeout(3000))).toBe('fake-token-2');
      expect(remote.refreshes()).toBe(1);
      expect(remote.failures).toEqual([]);
    } finally {
      await remote.close();
    }
  });
  it('rejects a mismatched state or issuer before redeeming the code', async () => {
    const remote = await fixture();
    let saved: string | undefined;
    try {
      const session = new RemoteOAuthSession({
        endpoint: `${remote.issuer}/mcp`,
        redirectUrl: 'http://127.0.0.1/callback',
        fixtureOrigin: remote.issuer,
        store: {
          read: () => Promise.resolve(saved),
          write: (value) => {
            saved = value;
            return Promise.resolve();
          },
        },
      });
      await session.initialize();
      const begin = await session.begin(AbortSignal.timeout(3000));
      await expect(
        session.complete(
          new URLSearchParams({ state: 'wrong', code: 'fixture-code', iss: remote.issuer }),
          AbortSignal.timeout(3000),
        ),
      ).rejects.toThrow();
      await expect(
        session.complete(
          new URLSearchParams({
            state: begin.state,
            code: 'fixture-code',
            iss: 'https://wrong.example',
          }),
          AbortSignal.timeout(3000),
        ),
      ).rejects.toThrow();
      expect(remote.exchanges()).toBe(0);
    } finally {
      await remote.close();
    }
  });
});
