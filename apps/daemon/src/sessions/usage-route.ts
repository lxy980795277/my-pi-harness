import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { UsageQuerySchema, SessionUsageSchema, type UsageQuery } from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';

type UsageHttpQuery = Omit<UsageQuery, 'includeDescendants'> & {
  includeDescendants?: 'true' | 'false';
};

const params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const query = Type.Object(
  {
    ...UsageQuerySchema.properties,
    includeDescendants: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
  },
  { additionalProperties: false },
);

/** Read one request-set aggregate without loading conversation or task transcripts. */
export function registerSessionUsageRoute(server: FastifyInstance, store: ProfileStore): void {
  server.get<{ Params: { id: string }; Querystring: UsageHttpQuery }>(
    '/api/sessions/:id/usage',
    { schema: { params, querystring: query, response: { 200: SessionUsageSchema } } },
    (request) => {
      const { includeDescendants, ...filters } = request.query;
      return store.getSessionUsage(request.params.id, {
        ...filters,
        ...(includeDescendants === undefined
          ? {}
          : { includeDescendants: includeDescendants === 'true' }),
      });
    },
  );
}
