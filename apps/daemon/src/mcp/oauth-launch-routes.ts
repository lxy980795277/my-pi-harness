import { Type } from 'typebox';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import {
  McpControlInputSchema,
  SkillOAuthLaunchTicketSchema,
  type McpControlInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../application/services.js';
import { requestOperation } from '../http/request-operation.js';

const McpParams = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const Ticket = Type.Object(
  { ticket: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }) },
  { additionalProperties: false },
);

/** Exchange one-time browser launch tickets for the selected standalone MCP OAuth flow. */
export function registerMcpOAuthLaunchRoutes(
  server: FastifyInstance,
  services: Pick<
    ApplicationServices,
    'remoteMcp' | 'oauthLaunchTickets' | 'auth' | 'listenerOrigin'
  >,
): void {
  server.post<{ Params: { id: string }; Body: McpControlInput }>(
    '/api/mcp/remote-servers/:id/oauth/launch-ticket',
    {
      schema: {
        params: McpParams,
        body: McpControlInputSchema,
        response: { 200: SkillOAuthLaunchTicketSchema },
      },
    },
    (request) => {
      const value = services.remoteMcp.get(request.params.id);
      if (
        value.revision !== request.body.expectedRevision ||
        value.accessEpoch !== request.body.expectedAccessEpoch
      )
        throw new RuntimeError('MCP_CONFLICT', 'MCP授权配置已改变。');
      return services.oauthLaunchTickets.create(
        'mcp',
        value.id,
        services.auth.applicationOrigin(request),
        value.name,
      );
    },
  );
  server.post<{ Params: { id: string }; Body: { ticket: string } }>(
    '/api/mcp/remote-servers/:id/oauth/launch',
    {
      schema: { params: McpParams, body: Ticket },
    },
    async (request, reply) => {
      services.oauthLaunchTickets.consume('mcp', request.params.id, request.body.ticket);
      const value = services.remoteMcp.get(request.params.id);
      return await requestOperation(request, reply, (signal) =>
        services.remoteMcp.beginOAuth(
          value.id,
          { expectedRevision: value.revision, expectedAccessEpoch: value.accessEpoch },
          `${services.listenerOrigin()}/api/mcp/oauth/callback`,
          signal,
        ),
      );
    },
  );
}
