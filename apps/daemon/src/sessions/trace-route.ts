import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  ModelRequestDetailQuerySchema,
  ModelRequestDetailSchema,
  TracePageSchema,
  TraceQuerySchema,
  TraceEntryDetailSchema,
  type ModelRequestDetailQuery,
  type TraceQuery,
} from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';

interface PageHttpQuery {
  cursor?: string;
  limit?: string;
}
type TraceHttpQuery = Omit<TraceQuery, 'cursor' | 'limit' | 'watermark' | 'includeDescendants'> &
  PageHttpQuery & { watermark?: string; includeDescendants?: 'true' | 'false' };
type DetailHttpQuery = Omit<ModelRequestDetailQuery, 'cursor' | 'limit' | 'offset'> &
  PageHttpQuery & { offset?: string };

const id = Type.String({ minLength: 1, maxLength: 160 });
const position = Type.String({ pattern: '^(0|[1-9][0-9]{0,14})$' });
const pageProperties = {
  cursor: Type.Optional(position),
  limit: Type.Optional(Type.String({ pattern: '^([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$' })),
};
const listQuery = Type.Object(
  {
    ...TraceQuerySchema.properties,
    ...pageProperties,
    watermark: Type.Optional(position),
    includeDescendants: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
  },
  { additionalProperties: false },
);
const detailQuery = Type.Object(
  {
    ...ModelRequestDetailQuerySchema.properties,
    ...pageProperties,
    offset: Type.Optional(position),
    limit: Type.Optional(Type.String({ pattern: '^([1-9]|[1-4][0-9]|50)$' })),
  },
  { additionalProperties: false },
);

function page(input: PageHttpQuery): { cursor?: number; limit?: number } {
  return {
    ...(input.cursor === undefined ? {} : { cursor: Number(input.cursor) }),
    ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
  };
}

function detail(input: DetailHttpQuery): ModelRequestDetailQuery {
  const { cursor: _cursor, limit: _limit, offset, ...filters } = input;
  return {
    ...filters,
    ...page(input),
    ...(offset === undefined ? {} : { offset: Number(offset) }),
  };
}

/** Read committed execution facts under the same application authorization as conversations. */
export function registerSessionTraceRoutes(server: FastifyInstance, store: ProfileStore): void {
  server.get<{
    Params: { id: string; requestId: string; itemIndex: string; imageIndex: string };
  }>(
    '/api/sessions/:id/trace/requests/:requestId/images/:itemIndex/:imageIndex',
    {
      schema: {
        params: Type.Object(
          { id, requestId: id, itemIndex: position, imageIndex: position },
          { additionalProperties: false },
        ),
        querystring: Type.Object({}, { additionalProperties: false }),
        response: {
          200: Type.String({ description: 'One explicitly requested model input image' }),
        },
      },
    },
    (request, reply) => {
      const image = store.getModelRequestImage(
        request.params.id,
        request.params.requestId,
        Number(request.params.itemIndex),
        Number(request.params.imageIndex),
      );
      return reply
        .type(image.mimeType)
        .header('Content-Length', image.bytes.byteLength)
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Buffer.from(image.bytes));
    },
  );
  server.get<{ Params: { id: string }; Querystring: TraceHttpQuery }>(
    '/api/sessions/:id/trace',
    {
      schema: {
        params: Type.Object({ id }, { additionalProperties: false }),
        querystring: listQuery,
        response: { 200: TracePageSchema },
      },
    },
    (request) => {
      const {
        cursor: _cursor,
        limit: _limit,
        watermark,
        includeDescendants,
        ...filters
      } = request.query;
      return store.listTrace(request.params.id, {
        ...filters,
        ...page(request.query),
        ...(watermark === undefined ? {} : { watermark: Number(watermark) }),
        ...(includeDescendants === undefined
          ? {}
          : { includeDescendants: includeDescendants === 'true' }),
      });
    },
  );
  server.get<{
    Params: { id: string; requestId: string };
    Querystring: DetailHttpQuery;
  }>(
    '/api/sessions/:id/trace/requests/:requestId',
    {
      schema: {
        params: Type.Object({ id, requestId: id }, { additionalProperties: false }),
        querystring: detailQuery,
        response: { 200: ModelRequestDetailSchema },
      },
    },
    (request) => {
      return store.getModelRequest(
        request.params.id,
        request.params.requestId,
        detail(request.query),
      );
    },
  );
  server.get<{ Params: { id: string; entryId: string }; Querystring: DetailHttpQuery }>(
    '/api/sessions/:id/trace/entries/:entryId',
    {
      schema: {
        params: Type.Object(
          { id, entryId: Type.String({ minLength: 1, maxLength: 200 }) },
          { additionalProperties: false },
        ),
        querystring: detailQuery,
        response: { 200: TraceEntryDetailSchema },
      },
    },
    (request) =>
      store.getTraceEntry(request.params.id, request.params.entryId, detail(request.query)),
  );
}
