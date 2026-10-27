import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import {
  McpMetadataSchema,
  McpScopeSchema,
  McpToolControlInputSchema,
  McpToolControlSchema,
  McpReadOnlyGrantInputSchema,
  McpReadOnlyGrantViewSchema,
  type McpScope,
  type McpToolControlInput,
  type McpReadOnlyGrantInput,
} from '@my-pi-harness/protocol';
import type { McpService } from './service.js';
import type { RemoteMcpService } from './remote-service.js';
const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const GrantParams = Type.Object(
  { ...Params.properties, grantId: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const ok = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });

/** Controls revoke the exact tool generation; cached metadata GETs never contact the server. */
export function registerMcpDirectoryRoutes(
  server: FastifyInstance,
  local: McpService,
  remote: RemoteMcpService,
): void {
  server.get<{ Params: { id: string }; Querystring: { scope: McpScope } }>(
    '/api/mcp/servers/:id/metadata',
    {
      schema: {
        params: Params,
        querystring: Type.Object({ scope: McpScopeSchema }, { additionalProperties: false }),
        response: { 200: Type.Union([McpMetadataSchema, Type.Null()]) },
      },
    },
    (request) => local.metadata(request.params.id, request.query.scope),
  );
  for (const [prefix, service] of [
    ['servers', local],
    ['remote-servers', remote],
  ] as const) {
    server.post<{ Params: { id: string }; Body: McpToolControlInput }>(
      `/api/mcp/${prefix}/:id/tool-control`,
      {
        schema: {
          params: Params,
          body: McpToolControlInputSchema,
          response: { 200: McpToolControlSchema },
        },
      },
      (request) => service.setToolControl(request.params.id, request.body),
    );
    server.get<{ Params: { id: string } }>(
      `/api/mcp/${prefix}/:id/readonly-grants`,
      { schema: { params: Params, response: { 200: Type.Array(McpReadOnlyGrantViewSchema) } } },
      (request) => service.readOnlyGrants(request.params.id),
    );
    server.post<{ Params: { id: string }; Body: McpReadOnlyGrantInput }>(
      `/api/mcp/${prefix}/:id/readonly-grants`,
      {
        schema: {
          params: Params,
          body: McpReadOnlyGrantInputSchema,
          response: { 200: Type.Object({ id: Type.String() }, { additionalProperties: false }) },
        },
      },
      (request) => service.grantReadOnly(request.params.id, request.body),
    );
    server.delete<{ Params: { id: string; grantId: string } }>(
      `/api/mcp/${prefix}/:id/readonly-grants/:grantId`,
      { schema: { params: GrantParams, response: { 200: ok } } },
      async (request) => {
        await service.revokeReadOnly(request.params.id, request.params.grantId);
        return { ok: true as const };
      },
    );
  }
}
