import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APP_VERSION,
  HealthResponseSchema,
  PROTOCOL_VERSION,
  RuntimeReadyEventSchema,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/config.js';
import { createDaemonApplication, type DaemonApplication } from '../src/server.js';
import { readSseRecord } from './support/sse.js';

const applications: DaemonApplication[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ server }) => server.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createApplication(
  webDistPath?: string,
  logger?: FastifyBaseLogger,
): Promise<DaemonApplication> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-server-config-'));
  temporaryDirectories.push(directory);
  const application = await createDaemonApplication(
    loadDaemonConfig({
      MY_PI_HARNESS_PROFILE_DIRECTORY: directory,
      MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
      MY_PI_HARNESS_PORT: '0',
      ...(webDistPath === undefined ? {} : { MY_PI_HARNESS_WEB_DIST_PATH: webDistPath }),
    }),
    logger,
  );
  applications.push(application);
  return application;
}

function listen(application: DaemonApplication): Promise<string> {
  return application.server.listen({ host: '127.0.0.1', port: 0 });
}

describe('local daemon API', () => {
  it('omits OAuth callback query values from automatic request logs', async () => {
    const messages: string[] = [];
    const logger = pino({ level: 'info' }, { write: (message) => messages.push(message) });
    const { server } = await createApplication(undefined, logger);
    server.get('/api/auth/callback/:providerId', (_request, reply) =>
      reply.code(303).redirect('/'),
    );
    const response = await server.inject({
      url: '/api/auth/callback/github?code=private-fixture-code&state=private-fixture-state',
    });
    expect(response.statusCode).toBe(303);
    expect(messages.join('')).toContain('/api/auth/callback/github');
    expect(messages.join('')).not.toContain('private-fixture-code');
    expect(messages.join('')).not.toContain('private-fixture-state');
  });

  it('reports the daemon identity through the shared health protocol', async () => {
    const application = await createApplication();
    const response = await application.server.inject({ method: 'GET', url: '/api/health' });
    const body: unknown = response.json();
    expect(response.statusCode).toBe(200);
    expect(Value.Check(HealthResponseSchema, body)).toBe(true);
    expect(body).toMatchObject({
      status: 'ready',
      appVersion: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      instanceId: application.identity.instanceId,
      startedAt: application.identity.startedAt,
      nodeVersion: process.versions.node,
    });
  });

  it('starts SSE with the same identity and releases a disconnected subscriber', async () => {
    const application = await createApplication();
    const origin = await listen(application);
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/runtime/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('SSE response has no body');
    const source = await readSseRecord(reader);
    expect(source).toContain('event: runtime.ready\n');
    const data = source.split('\n').find((line) => line.startsWith('data: '));
    if (data === undefined) throw new Error('SSE response has no ready record');
    const event: unknown = JSON.parse(data.slice(6));
    expect(Value.Check(RuntimeReadyEventSchema, event)).toBe(true);
    expect(event).toEqual(application.identity);
    expect(application.streams.activeConnections).toBe(1);
    await reader.cancel();
    controller.abort();
    await expect.poll(() => application.streams.activeConnections).toBe(0);
  });

  it('ends live SSE responses before HTTP shutdown finishes', async () => {
    const application = await createApplication();
    const origin = await listen(application);
    const response = await fetch(`${origin}/api/runtime/events`);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('SSE response has no body');
    await readSseRecord(reader);
    const end = reader.read();
    await application.server.close();
    expect((await end).done).toBe(true);
    expect(application.streams.activeConnections).toBe(0);
  });

  it('answers an unsupported SSE HEAD request without creating a stream', async () => {
    const application = await createApplication();
    const origin = await listen(application);
    const response = await fetch(`${origin}/api/runtime/events`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(404);
    expect(application.streams.activeConnections).toBe(0);
  });

  it('closes an HTTP connection whose request headers are incomplete', async () => {
    const application = await createApplication();
    await listen(application);
    const address = application.server.server.address();
    if (address === null || typeof address === 'string') throw new Error('No TCP listener');
    const accepted = new Promise<Socket>((resolve) => {
      application.server.server.once('connection', resolve);
    });
    const client = connect({ host: '127.0.0.1', port: address.port });
    const connected = once(client, 'connect');
    let peer: Socket | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      peer = await accepted;
      await connected;
      const received = once(peer, 'data');
      client.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\n');
      await received;
      await Promise.race([
        application.server.close(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Incomplete headers blocked shutdown')),
            2_000,
          );
        }),
      ]);
      expect(peer.destroyed).toBe(true);
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      client.destroy();
      peer?.destroy();
      await application.server.close();
    }
  });

  it('serves SPA routes without hiding unknown API routes behind index.html', async () => {
    const webDistPath = await mkdtemp(join(tmpdir(), 'my-pi-harness-web-'));
    temporaryDirectories.push(webDistPath);
    await writeFile(
      join(webDistPath, 'index.html'),
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'; style-src \'self\'"><title>Local Harness</title></head><body></body></html>',
    );
    const { server } = await createApplication(webDistPath);
    const page = await server.inject({ url: '/sessions/one', headers: { accept: 'text/html' } });
    const api = await server.inject({ url: '/api/missing', headers: { accept: 'text/html' } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.body).toContain('<title>Local Harness</title>');
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
    const first = await server.inject({ url: '/' });
    const next = await server.inject({ url: '/index.html' });
    const nonce = /property="csp-nonce" nonce="([A-Za-z0-9+/=]+)"/.exec(first.body)?.[1];
    expect(nonce).toBeDefined();
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(first.body).toContain("script-src 'self';");
    expect(first.body).not.toContain('unsafe-inline');
    expect(next.body).not.toContain(`nonce="${nonce}"`);
  });

  it('rejects configured Web assets that do not contain an application entry', async () => {
    const webDistPath = await mkdtemp(join(tmpdir(), 'my-pi-harness-empty-web-'));
    temporaryDirectories.push(webDistPath);
    await expect(createApplication(webDistPath)).rejects.toThrow();
  });
});
