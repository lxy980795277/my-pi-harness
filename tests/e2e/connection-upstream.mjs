import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

/** Synthetic GitHub account verification used only by the isolated browser daemon. */
export async function startConnectionUpstream() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (
      request.method === 'POST' &&
      (request.url === '/github/login/oauth/access_token' || request.url === '/google/token')
    ) {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.once('end', () => {
        const fields = new URLSearchParams(body);
        const verifier = fields.get('code_verifier');
        const challenge = createHash('sha256')
          .update(verifier ?? '')
          .digest('base64url');
        const browserClient =
          fields.get('client_id')?.startsWith('synthetic-browser-oauth-client') &&
          fields.get('client_secret') === 'synthetic-browser-oauth-secret';
        const configuredGitHubClient =
          request.url === '/github/login/oauth/access_token' &&
          fields.get('client_id') === 'synthetic-e2e-client-id' &&
          fields.get('client_secret') === 'synthetic-e2e-client-secret';
        if (
          (fields.get('code') !== 'synthetic-browser-oauth-code' &&
            fields.get('code') !== `synthetic-browser-oauth-code-${challenge}`) ||
          !verifier ||
          (!browserClient && !configuredGitHubClient)
        ) {
          response.writeHead(400);
          response.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        let token = 'synthetic-browser-connection-token';
        if (request.url === '/google/token') token = 'synthetic-browser-google-token';
        if (fields.get('client_id').endsWith('-second')) token += '-second';
        response.end(
          JSON.stringify({
            access_token: token,
            token_type: 'bearer',
            expires_in: 3600,
            ...(request.url === '/google/token'
              ? {
                  id_token: `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'google-browser-account', email: 'google-browser@example.test', name: 'Browser Google account', picture: 'https://example.test/avatar.png' })).toString('base64url')}.synthetic`,
                }
              : {}),
          }),
        );
      });
      return;
    }
    if (
      request.method === 'GET' &&
      request.url === '/google/oauth2/v3/userinfo' &&
      request.headers.authorization === 'Bearer synthetic-browser-google-token'
    ) {
      response.end(
        JSON.stringify({ sub: 'google-browser-account', name: 'Browser Google account' }),
      );
      return;
    }
    if (
      request.method === 'GET' &&
      request.url === '/github/user' &&
      request.headers.authorization === 'Bearer synthetic-browser-connection-token-second'
    ) {
      response.end(
        JSON.stringify({
          id: 8265,
          login: 'second-browser',
          name: 'Second browser account',
          avatar_url: 'https://example.test/avatar.png',
        }),
      );
      return;
    }
    if (
      request.method === 'GET' &&
      request.url === '/github/user' &&
      request.headers.authorization === 'Bearer synthetic-browser-connection-token'
    ) {
      response.end(
        JSON.stringify({
          id: 8264,
          login: 'browser-account',
          name: 'Browser connection account',
          avatar_url: 'https://example.test/avatar.png',
        }),
      );
      return;
    }
    response.writeHead(401);
    response.end(JSON.stringify({ error: 'fixture_request_rejected' }));
  });
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((accept, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else accept();
        });
      }),
  };
}
