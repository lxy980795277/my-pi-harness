import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import {
  APP_VERSION,
  HealthResponseSchema,
  PROTOCOL_VERSION,
  type HealthResponse,
  type RuntimeReadyEvent,
} from '@my-pi-harness/protocol';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { DaemonConfig } from './config.js';
import { RuntimeEventStreams } from './runtime-events.js';

/** Resources owned by one local daemon process. */
export interface DaemonApplication {
  server: FastifyInstance;
  streams: RuntimeEventStreams;
  identity: RuntimeReadyEvent;
}

/**
 * Assemble the read-only M0 API and optional compiled Web application.
 * @param config Validated listener and asset settings.
 * @param logger An optional stderr logger; omitted loggers leave embedded servers quiet.
 * @returns An unlistened server with its SSE resources and instance identity.
 */
export async function createDaemonApplication(
  config: DaemonConfig,
  logger?: FastifyBaseLogger,
): Promise<DaemonApplication> {
  const server = Fastify({
    forceCloseConnections: true,
    ...(logger === undefined ? { logger: false } : { loggerInstance: logger }),
  });
  const identity: RuntimeReadyEvent = {
    type: 'runtime.ready',
    protocolVersion: PROTOCOL_VERSION,
    instanceId: randomUUID(),
    startedAt: Date.now(),
  };
  const streams = new RuntimeEventStreams(identity);
  server.addHook('preClose', (done) => {
    streams.close();
    done();
  });

  server.get<{ Reply: HealthResponse }>(
    '/api/health',
    {
      schema: { response: { 200: HealthResponseSchema } },
    },
    (_request, reply) => {
      reply.send({
        status: 'ready',
        appVersion: APP_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        instanceId: identity.instanceId,
        startedAt: identity.startedAt,
        nodeVersion: process.versions.node,
      });
    },
  );

  server.get('/api/runtime/events', { exposeHeadRoute: false }, (_request, reply) => {
    reply.hijack();
    streams.subscribe(reply.raw);
    return reply;
  });

  if (config.webDistPath !== null) {
    const root = config.webDistPath;
    if (!(await stat(root)).isDirectory() || !(await stat(join(root, 'index.html'))).isFile()) {
      throw new Error('Web assets must contain an index.html file');
    }
    await server.register(fastifyStatic, { root });
    server.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0] ?? request.url;
      if (
        request.method === 'GET' &&
        !/^\/api(?:\/|$)/.test(pathname) &&
        request.headers.accept?.includes('text/html')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Resource not found' });
    });
  }
  return { server, streams, identity };
}
