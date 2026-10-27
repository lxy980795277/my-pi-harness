import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import {
  RemoteMcpInputSchema,
  RemoteMcpUpdateSchema,
  RemoteMcpViewSchema,
  RemoteMcpTrustInputSchema,
  RemoteMcpTrustPreviewSchema,
  RemoteMcpDraftTestInputSchema,
  RemoteMcpDraftTestResultSchema,
  McpControlInputSchema,
  McpRevisionInputSchema,
  McpSecretInputSchema,
  McpToolCatalogSchema,
  McpMetadataSchema,
  type RemoteMcpInput,
  type RemoteMcpUpdate,
  type RemoteMcpTrustInput,
  type RemoteMcpDraftTestInput,
  type McpControlInput,
  type McpRevisionInput,
  type McpSecretInput,
} from '@my-pi-harness/protocol';
import type { RemoteMcpService } from './remote-service.js';
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
const OAuthStart = Type.Object(
  { url: Type.String(), state: Type.String(), expiresAt: Type.Integer() },
  { additionalProperties: false },
);

/** Remote management is protected by the same application-auth and CSRF hooks as stdio management. */
export function registerRemoteMcpRoutes(
  server: FastifyInstance,
  mcp: RemoteMcpService,
  resultOrigin?: () => string,
): void {
  server.post<{ Body: RemoteMcpDraftTestInput }>(
    '/api/mcp/remote-servers/test-draft',
    {
      schema: {
        body: RemoteMcpDraftTestInputSchema,
        response: { 200: RemoteMcpDraftTestResultSchema },
      },
    },
    (request, reply) =>
      requestOperation(
        request,
        reply,
        (signal) => mcp.testDraft(request.body, signal),
        null,
        'writableFinished',
      ),
  );
  server.get(
    '/api/mcp/remote-servers',
    { schema: { response: { 200: Type.Array(RemoteMcpViewSchema) } } },
    () => mcp.list(),
  );
  server.post<{ Body: RemoteMcpInput }>(
    '/api/mcp/remote-servers',
    { schema: { body: RemoteMcpInputSchema, response: { 200: RemoteMcpViewSchema } } },
    (request) => mcp.create(request.body),
  );
  server.get<{ Params: { id: string } }>(
    '/api/mcp/remote-servers/:id',
    { schema: { params: Params, response: { 200: RemoteMcpViewSchema } } },
    (request) => mcp.get(request.params.id),
  );
  server.put<{ Params: { id: string }; Body: RemoteMcpUpdate }>(
    '/api/mcp/remote-servers/:id',
    {
      schema: {
        params: Params,
        body: RemoteMcpUpdateSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.update(request.params.id, request.body),
  );
  server.delete<{ Params: { id: string }; Body: McpRevisionInput }>(
    '/api/mcp/remote-servers/:id',
    { schema: { params: Params, body: McpRevisionInputSchema, response: { 200: ok } } },
    async (request) => {
      await mcp.remove(request.params.id, request.body.expectedRevision);
      return { ok: true as const };
    },
  );
  server.post<{ Params: { id: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/trust-preview',
    {
      schema: {
        params: Params,
        body: McpControlInputSchema,
        response: { 200: RemoteMcpTrustPreviewSchema },
      },
    },
    (request) => mcp.preview(request.params.id, request.body),
  );
  server.post<{ Params: { id: string }; Body: RemoteMcpTrustInput }>(
    '/api/mcp/remote-servers/:id/trust',
    {
      schema: {
        params: Params,
        body: RemoteMcpTrustInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.trust(request.params.id, request.body),
  );
  for (const action of ['disable', 'revoke-trust'])
    server.post<{ Params: { id: string }; Body: McpControlInput }>(
      `/api/mcp/remote-servers/:id/${action}`,
      {
        schema: {
          params: Params,
          body: McpControlInputSchema,
          response: { 200: RemoteMcpViewSchema },
        },
      },
      (request) => mcp.disable(request.params.id, request.body),
    );
  server.post<{ Params: { id: string; slotId: string }; Body: McpSecretInput }>(
    '/api/mcp/remote-servers/:id/secrets/:slotId',
    {
      schema: {
        params: SecretParams,
        body: McpSecretInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.writeSecret(request.params.id, request.params.slotId, request.body),
  );
  server.post<{ Params: { id: string }; Body: McpSecretInput }>(
    '/api/mcp/remote-servers/:id/oauth/client-secret',
    {
      schema: {
        params: Params,
        body: McpSecretInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.writeOAuthClientSecret(request.params.id, request.body),
  );
  server.delete<{ Params: { id: string; slotId: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/secrets/:slotId',
    {
      schema: {
        params: SecretParams,
        body: McpControlInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.deleteSecret(request.params.id, request.params.slotId, request.body),
  );
  server.delete<{ Params: { id: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/oauth/client-secret',
    {
      schema: {
        params: Params,
        body: McpControlInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.deleteOAuthClientSecret(request.params.id, request.body),
  );
  for (const action of ['discover', 'test'])
    server.post<{ Params: { id: string }; Body: McpControlInput }>(
      `/api/mcp/remote-servers/:id/${action}`,
      {
        schema: {
          params: Params,
          body: McpControlInputSchema,
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
  server.get<{ Params: { id: string } }>(
    '/api/mcp/remote-servers/:id/tools',
    {
      schema: {
        params: Params,
        response: { 200: Type.Union([McpToolCatalogSchema, Type.Null()]) },
      },
    },
    (request) => mcp.catalog(request.params.id),
  );
  server.get<{ Params: { id: string } }>(
    '/api/mcp/remote-servers/:id/metadata',
    { schema: { params: Params, response: { 200: Type.Union([McpMetadataSchema, Type.Null()]) } } },
    (request) => mcp.metadata(request.params.id),
  );
  server.post<{ Params: { id: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/oauth/start',
    { schema: { params: Params, body: McpControlInputSchema, response: { 200: OAuthStart } } },
    async (request) => {
      const address = server.server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Daemon address is unavailable');
      const redirect = `http://127.0.0.1:${address.port}/api/mcp/oauth/callback`;
      return await mcp.beginOAuth(
        request.params.id,
        request.body,
        redirect,
        AbortSignal.timeout(30000),
      );
    },
  );
  server.post<{ Params: { id: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/oauth/cancel',
    {
      schema: {
        params: Params,
        body: McpControlInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.cancelOAuth(request.params.id, request.body),
  );
  server.post<{ Params: { id: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/oauth/disconnect',
    {
      schema: {
        params: Params,
        body: McpControlInputSchema,
        response: { 200: RemoteMcpViewSchema },
      },
    },
    (request) => mcp.disconnectOAuth(request.params.id, request.body),
  );
  server.get<{
    Querystring: {
      state?: string;
      code?: string;
      iss?: string;
      error?: string;
      error_description?: string;
    };
  }>(
    '/api/mcp/oauth/callback',
    {
      schema: {
        querystring: Type.Object(
          {
            state: Type.Optional(Type.String({ maxLength: 256 })),
            code: Type.Optional(Type.String({ maxLength: 4096 })),
            iss: Type.Optional(Type.String({ maxLength: 8192 })),
            error: Type.Optional(Type.String({ maxLength: 256 })),
            error_description: Type.Optional(Type.String({ maxLength: 4096 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(request.query))
        if (value !== undefined) params.set(name, value);
      if (resultOrigin === undefined) {
        await mcp.completeOAuth(params, AbortSignal.timeout(30000));
        return reply
          .type('text/plain; charset=utf-8')
          .send('MCP授权完成，请返回应用刷新连接状态。');
      }
      const result = new URL('/skill-oauth/result', resultOrigin());
      result.searchParams.set('name', 'MCP');
      try {
        await mcp.completeOAuth(params, AbortSignal.timeout(30000));
        result.searchParams.set('status', 'success');
      } catch {
        result.searchParams.set('status', 'error');
        result.searchParams.set('message', 'MCP授权未完成或已失效，请返回应用重试。');
      }
      return reply.redirect(result.href, 303);
    },
  );
}
