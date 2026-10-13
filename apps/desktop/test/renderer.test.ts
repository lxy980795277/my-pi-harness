import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRendererUrl, waitForRenderer } from '../src/main/renderer.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => {
            if (error !== undefined) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

function listen(server: Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('No local server address'));
      } else resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('desktop renderer startup', () => {
  it.each([
    'https://127.0.0.1:5174',
    'http://example.com:5174',
    'http://127.0.0.1:0',
    'http://127.0.0.1:5174@example.com',
    'http://user:password@127.0.0.1:5174',
    'file:///tmp/application.html',
  ])('rejects an uncontrolled Web address %s', (url) => {
    expect(() => resolveRendererUrl(url)).toThrow();
  });

  it('accepts a ready local development server', async () => {
    const origin = await listen(createServer((_request, response) => response.end('ready')));
    await expect(
      waitForRenderer(resolveRendererUrl(origin), new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('aborts an active readiness request when desktop shutdown begins', async () => {
    let received: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      received = resolve;
    });
    const origin = await listen(createServer(() => received?.()));
    const controller = new AbortController();
    const readiness = expect(waitForRenderer(origin, controller.signal)).rejects.toThrow(
      'Closing desktop',
    );
    await requested;
    controller.abort(new Error('Closing desktop'));
    await readiness;
  });
});
