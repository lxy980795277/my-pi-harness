import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import {
  APP_VERSION,
  HealthResponseSchema,
  PROTOCOL_VERSION,
  type HealthResponse,
  type RuntimeReadyEvent,
} from '@my-pi-harness/protocol';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { DaemonConfig } from '../application/config.js';
import type { ApplicationServices } from '../application/services.js';
import { registerApplicationRoutes } from './routes.js';
import { RuntimeEventStreams } from './runtime-events.js';
import { createWebDocumentRenderer } from './web-document.js';

/** Resources owned by one local daemon process. */
export interface DaemonApplication {
  server: FastifyInstance;
  streams: RuntimeEventStreams;
  identity: RuntimeReadyEvent;
}

/**
 * Assemble the local HTTP API and optional compiled Web application.
 * @param config Validated listener and asset settings.
 * @param logger An optional stderr logger; omitted loggers leave embedded servers quiet.
 * @returns An unlistened server with its SSE resources and instance identity.
 */
export async function createDaemonApplication(
  config: DaemonConfig,
  logger?: FastifyBaseLogger,
  services?: ApplicationServices,
): Promise<DaemonApplication> {
  const server = Fastify({
    forceCloseConnections: true,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
    bodyLimit: 256 * 1024,
    ...(logger === undefined ? { logger: false } : { loggerInstance: logger }),
  });
  server.setChildLoggerFactory((logger, bindings, options) =>
    logger.child(bindings, {
      ...options,
      serializers: {
        ...options.serializers,
        req: (request: FastifyRequest) => {
          const queryStart = request.url.indexOf('?');
          let url = request.url;
          if (queryStart !== -1) url = request.url.slice(0, queryStart);
          return {
            method: request.method,
            url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    }),
  );
  server.addHook('onSend', (request, reply, payload, done) => {
    reply.header('Content-Security-Policy', "frame-ancestors 'none'");
    reply.header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    done(null, payload);
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

  if (services) registerApplicationRoutes(server, services);

  if (config.webDistPath !== null) {
    const root = config.webDistPath;
    if (!(await stat(root)).isDirectory() || !(await stat(join(root, 'index.html'))).isFile()) {
      throw new Error('Web assets must contain an index.html file');
    }
    const renderDocument = createWebDocumentRenderer(
      await readFile(join(root, 'index.html'), 'utf8'),
    );
    const sendDocument = (_request: FastifyRequest, reply: FastifyReply): void => {
      reply
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(renderDocument());
    };
    server.get('/', sendDocument);
    server.get('/index.html', sendDocument);
    await server.register(fastifyStatic, { root, index: false });
    server.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0] ?? request.url;
      if (
        request.method === 'GET' &&
        !/^\/api(?:\/|$)/.test(pathname) &&
        request.headers.accept?.includes('text/html')
      ) {
        return reply
          .header('Cache-Control', 'no-store')
          .type('text/html; charset=utf-8')
          .send(renderDocument());
      }
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Resource not found' });
    });
  }
  return { server, streams, identity };
}
