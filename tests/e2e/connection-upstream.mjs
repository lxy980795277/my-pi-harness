import { createServer } from 'node:http';

/** Synthetic GitHub account verification used only by the isolated browser daemon. */
export async function startConnectionUpstream() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (
      request.method === 'GET' &&
      request.url === '/github/user' &&
      request.headers.authorization === 'Bearer synthetic-browser-connection-token'
    ) {
      response.end(JSON.stringify({ id: 8264, name: 'Browser connection account' }));
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
