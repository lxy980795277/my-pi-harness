import {
  McpControlInputSchema,
  McpRevisionInputSchema,
  McpScopeInputSchema,
  McpScopeSchema,
  McpSecretInputSchema,
  McpServerInputSchema,
  McpServerUpdateSchema,
  McpServerViewSchema,
  McpToolCatalogSchema,
  McpTrustInputSchema,
  McpTrustPreviewSchema,
  type McpControlInput,
  type McpRevisionInput,
  type McpScope,
  type McpScopeInput,
  type McpSecretInput,
  type McpServerInput,
  type McpServerUpdate,
  type McpTrustInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { McpService } from './service.js';
import { requestOperation } from '../http/request-operation.js';

const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const SecretParams = Type.Object(
  { ...Params.properties, slotId: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const ok = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });

/** Protected management GETs never launch processes or discover tools implicitly. */
export function registerMcpRoutes(server: FastifyInstance, mcp: McpService): void {
  server.get(
    '/api/mcp/servers',
    { schema: { response: { 200: Type.Array(McpServerViewSchema) } } },
    () => mcp.list(),
  );
  server.get<{ Params: { id: string } }>(
    '/api/mcp/servers/:id',
    { schema: { params: Params, response: { 200: McpServerViewSchema } } },
    (request) => mcp.get(request.params.id),
  );
  server.post<{ Body: McpServerInput }>(
    '/api/mcp/servers',
    { schema: { body: McpServerInputSchema, response: { 200: McpServerViewSchema } } },
    (request) => mcp.create(request.body),
  );
  server.put<{ Params: { id: string }; Body: McpServerUpdate }>(
    '/api/mcp/servers/:id',
    {
      schema: {
        params: Params,
        body: McpServerUpdateSchema,
        response: { 200: McpServerViewSchema },
      },
    },
    (request) => mcp.update(request.params.id, request.body),
  );
  server.delete<{ Params: { id: string }; Body: McpRevisionInput }>(
    '/api/mcp/servers/:id',
    { schema: { params: Params, body: McpRevisionInputSchema, response: { 200: ok } } },
    async (request) => {
      await mcp.remove(request.params.id, request.body.expectedRevision);
      return { ok: true as const };
    },
  );
  server.post<{ Params: { id: string; slotId: string }; Body: McpSecretInput }>(
    '/api/mcp/servers/:id/secrets/:slotId',
    {
      schema: {
        params: SecretParams,
        body: McpSecretInputSchema,
        response: { 200: McpServerViewSchema },
      },
    },
    (request) => mcp.writeSecret(request.params.id, request.params.slotId, request.body),
  );
  server.delete<{ Params: { id: string; slotId: string }; Body: McpControlInput }>(
    '/api/mcp/servers/:id/secrets/:slotId',
    {
      schema: {
        params: SecretParams,
        body: McpControlInputSchema,
        response: { 200: McpServerViewSchema },
      },
    },
    (request) => mcp.deleteSecret(request.params.id, request.params.slotId, request.body),
  );
  server.post<{ Params: { id: string }; Body: McpScopeInput }>(
    '/api/mcp/servers/:id/trust-preview',
    {
      schema: {
        params: Params,
        body: McpScopeInputSchema,
        response: { 200: McpTrustPreviewSchema },
      },
    },
    (request) => mcp.preview(request.params.id, request.body),
  );
  server.post<{ Params: { id: string }; Body: McpTrustInput }>(
    '/api/mcp/servers/:id/trust',
    {
      schema: { params: Params, body: McpTrustInputSchema, response: { 200: McpServerViewSchema } },
    },
    (request) => mcp.trust(request.params.id, request.body),
  );
  for (const action of ['disable', 'revoke-trust']) {
    server.post<{ Params: { id: string }; Body: McpControlInput }>(
      `/api/mcp/servers/:id/${action}`,
      {
        schema: {
          params: Params,
          body: McpControlInputSchema,
          response: { 200: McpServerViewSchema },
        },
      },
      (request) => mcp.disable(request.params.id, request.body),
    );
  }
  for (const action of ['discover', 'test']) {
    server.post<{ Params: { id: string }; Body: McpScopeInput }>(
      `/api/mcp/servers/:id/${action}`,
      {
        schema: {
          params: Params,
          body: McpScopeInputSchema,
          response: { 200: McpToolCatalogSchema },
        },
      },
      (request, reply) =>
        requestOperation(
          request,
          reply,
          (signal) => mcp.discover(request.params.id, request.body, signal),
          null,
          'writableFinished',
        ),
    );
  }
  server.get<{ Params: { id: string }; Querystring: { scope: McpScope } }>(
    '/api/mcp/servers/:id/tools',
    {
      schema: {
        params: Params,
        querystring: Type.Object({ scope: McpScopeSchema }, { additionalProperties: false }),
        response: { 200: Type.Union([McpToolCatalogSchema, Type.Null()]) },
      },
    },
    (request) => mcp.catalog(request.params.id, request.query.scope),
  );
}
