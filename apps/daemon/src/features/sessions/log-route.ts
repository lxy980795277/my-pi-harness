import type { ProfileStore } from '@my-pi-harness/storage';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

/** Explicit authenticated download of host JSONL, separate from public session projections. */
export function registerSessionLogRoute(server: FastifyInstance, store: ProfileStore): void {
  server.get<{ Params: { id: string } }>(
    '/api/sessions/:id/log',
    {
      schema: {
        params: Type.Object(
          { id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,160}$' }) },
          { additionalProperties: false },
        ),
        querystring: Type.Object({}, { additionalProperties: false }),
        response: { 200: Type.String({ description: 'Original durable session JSONL bytes' }) },
      },
    },
    (request, reply) => {
      const download = store.exportSessionLog(request.params.id);
      return reply
        .type('application/x-ndjson; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${request.params.id}.jsonl"`)
        .header('Content-Length', download.byteLength)
        .header('X-Content-Type-Options', 'nosniff')
        .send(download.content);
    },
  );
}
