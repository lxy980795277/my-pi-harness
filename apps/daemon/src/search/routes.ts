import {
  SearchIndexStatusSchema,
  SearchModelStatusSchema,
  SearchRerankerStatusSchema,
  SearchQueryInputSchema,
  SearchQueryResultSchema,
  SearchSourceReadInputSchema,
  SearchSourceWindowSchema,
  type SearchQueryInput,
  type SearchSourceReadInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { requestOperation } from '../http/request-operation';
import type { SearchService } from './service';

const Empty = Type.Object({}, { additionalProperties: false });

/** Status reads are inert; explicit commands schedule work owned by the authenticated daemon. */
export function registerSearchRoutes(server: FastifyInstance, search: SearchService): void {
  server.get('/api/search/model', { schema: { response: { 200: SearchModelStatusSchema } } }, () =>
    search.modelStatus(),
  );
  server.post(
    '/api/search/model/prepare',
    { schema: { body: Empty, response: { 200: SearchModelStatusSchema } } },
    () => search.prepare(),
  );
  server.post(
    '/api/search/model/cancel',
    { schema: { body: Empty, response: { 200: SearchModelStatusSchema } } },
    async () => await search.cancelPreparation(),
  );
  server.get(
    '/api/search/reranker',
    { schema: { response: { 200: SearchRerankerStatusSchema } } },
    () => search.rerankerStatus(),
  );
  server.post(
    '/api/search/reranker/prepare',
    { schema: { body: Empty, response: { 200: SearchRerankerStatusSchema } } },
    () => search.prepareReranker(),
  );
  server.post(
    '/api/search/reranker/cancel',
    { schema: { body: Empty, response: { 200: SearchRerankerStatusSchema } } },
    async () => await search.cancelRerankerPreparation(),
  );
  server.get('/api/search/index', { schema: { response: { 200: SearchIndexStatusSchema } } }, () =>
    search.indexStatus(),
  );
  server.post(
    '/api/search/index/rebuild',
    { schema: { body: Empty, response: { 200: SearchIndexStatusSchema } } },
    () => search.rebuild(),
  );
  server.post<{ Body: SearchQueryInput }>(
    '/api/search',
    {
      schema: { body: SearchQueryInputSchema, response: { 200: SearchQueryResultSchema } },
    },
    async (request, reply) =>
      await requestOperation(request, reply, (signal) => search.search(request.body, signal)),
  );
  server.post<{ Body: SearchSourceReadInput }>(
    '/api/search/source',
    {
      schema: { body: SearchSourceReadInputSchema, response: { 200: SearchSourceWindowSchema } },
    },
    (request) => search.source(request.body),
  );
}
