import type { ServerResponse } from 'node:http';
import type { SessionRuntime } from '@my-pi-harness/agent-runtime';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { LocalAuth } from '../auth/local-auth.js';
import { startSessionStream } from './stream-connection.js';

/** Registers private SSE connections; each connection starts from a fresh committed baseline. */
export const registerSessionStreamRoute = (
  server: FastifyInstance,
  runtime: SessionRuntime,
  auth: LocalAuth,
): void => {
  const live = new Map<ServerResponse, () => void>();
  server.addHook('preClose', (done) => {
    for (const close of live.values()) close();
    done();
  });
  server.get<{ Params: { id: string } }>(
    '/api/sessions/:id/events',
    {
      exposeHeadRoute: false,
      schema: {
        params: Type.Object(
          { id: Type.String({ minLength: 1, maxLength: 160 }) },
          { additionalProperties: false },
        ),
        querystring: Type.Object({}, { additionalProperties: false }),
      },
    },
    (request, reply) => {
      const sessionId = request.params.id;
      // Resolve missing/disabled sessions before handing ownership to the streaming response.
      runtime.getSnapshot(sessionId);
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const close = startSessionStream({
        response,
        snapshot: () => runtime.getSnapshot(sessionId),
        subscribe: (changed) => runtime.subscribe(sessionId, changed),
        authorized: () => auth.isAuthorized(request),
        watchAuthorization: (revoked) => auth.watch(request, revoked),
        onClose: () => live.delete(response),
      });
      if (!response.destroyed && !response.writableEnded) live.set(response, close);
      return reply;
    },
  );
};
