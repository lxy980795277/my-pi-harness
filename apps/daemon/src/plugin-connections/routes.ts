import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  SkillConnectionStatusSchema,
  SkillOAuthStartSchema,
  SkillOAuthLaunchTicketSchema,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../application/services.js';
import { requestOperation } from '../http/request-operation.js';
import { requestPluginGateway } from './gateway.js';
import { describePluginOAuthFailure } from './failure.js';
import { PluginError, pluginConnectionDefinition } from '@my-pi-harness/integrations';

const Params = Type.Object(
  { collectionId: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }) },
  { additionalProperties: false },
);
const Empty = Type.Object({}, { additionalProperties: false });
const Ticket = Type.Object(
  { ticket: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }) },
  { additionalProperties: false },
);
const Query = Type.Object(
  {
    state: Type.String({ minLength: 1, maxLength: 256 }),
    code: Type.Optional(Type.String({ maxLength: 4096 })),
    error: Type.Optional(Type.String({ maxLength: 256 })),
    error_description: Type.Optional(Type.String({ maxLength: 4096 })),
    iss: Type.Optional(Type.String({ maxLength: 8192 })),
  },
  { additionalProperties: true },
);

/** Plugin OAuth and its authenticated read gateway are independent of application login tokens. */
export function registerPluginConnectionRoutes(
  server: FastifyInstance,
  services: ApplicationServices,
): void {
  const connections = services.pluginConnections;
  server.get<{ Params: { collectionId: string } }>(
    '/api/skill-connections/:collectionId',
    {
      schema: { params: Params, response: { 200: SkillConnectionStatusSchema } },
    },
    async (request, reply) =>
      await requestOperation(request, reply, (signal) =>
        connections.status(request.params.collectionId, signal),
      ),
  );
  server.post<{ Params: { collectionId: string } }>(
    '/api/skill-connections/:collectionId/oauth',
    {
      schema: { params: Params, response: { 200: SkillOAuthStartSchema } },
    },
    async (request, reply) => {
      if (request.body !== undefined && !Value.Check(Empty, request.body))
        throw new PluginError('INVALID_REQUEST', '授权请求不能包含客户端配置。');
      return await requestOperation(request, reply, (signal) =>
        connections.startOAuth(request.params.collectionId, signal),
      );
    },
  );
  server.delete<{ Params: { collectionId: string } }>(
    '/api/skill-connections/:collectionId',
    {
      schema: { params: Params },
    },
    async (request, reply) => {
      await connections.disconnect(request.params.collectionId);
      return reply.code(204).send();
    },
  );
  server.post<{ Params: { collectionId: string } }>(
    '/api/skill-connections/:collectionId/oauth/launch-ticket',
    {
      schema: { params: Params, body: Empty, response: { 200: SkillOAuthLaunchTicketSchema } },
    },
    (request) => {
      const definition = connections.authorizationDefinition(request.params.collectionId);
      return services.oauthLaunchTickets.create(
        'plugin',
        definition.id,
        services.auth.applicationOrigin(request),
        definition.name,
      );
    },
  );
  server.post<{ Params: { collectionId: string }; Body: { ticket: string } }>(
    '/api/skill-connections/:collectionId/oauth/launch',
    {
      schema: { params: Params, body: Ticket, response: { 200: SkillOAuthStartSchema } },
    },
    async (request, reply) => {
      services.oauthLaunchTickets.consume(
        'plugin',
        request.params.collectionId,
        request.body.ticket,
      );
      return await requestOperation(request, reply, (signal) =>
        connections.startOAuth(request.params.collectionId, signal),
      );
    },
  );
  server.get<{ Params: { collectionId: string }; Querystring: Record<string, unknown> }>(
    '/api/skill-connections/:collectionId/oauth/callback',
    {
      schema: { params: Params, querystring: Query },
    },
    async (request, reply) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(request.query))
        if (typeof value === 'string') params.set(key, value);
      const result = new URL('/skill-oauth/result', services.webOrigin());
      result.searchParams.set('name', pluginConnectionDefinition(request.params.collectionId).name);
      try {
        await requestOperation(request, reply, (signal) =>
          connections.completeOAuth(request.params.collectionId, params, signal),
        );
        result.searchParams.set('status', 'success');
      } catch (error: unknown) {
        const failure = describePluginOAuthFailure(error);
        request.log.warn(
          {
            pluginId: request.params.collectionId,
            phase: failure.phase,
            reason: failure.reason,
            ...(failure.upstreamStatus === undefined
              ? {}
              : { upstreamStatus: failure.upstreamStatus }),
          },
          'Plugin OAuth callback failed',
        );
        result.searchParams.set('status', 'error');
        result.searchParams.set('message', failure.message);
      }
      return reply.header('Referrer-Policy', 'no-referrer').redirect(result.href, 303);
    },
  );
  server.get<{ Params: { collectionId: string; '*': string } }>(
    '/api/skill-gateway/:collectionId/*',
    async (request, reply) => {
      const definition = connections.definition(request.params.collectionId);
      const result = await requestOperation(request, reply, async (signal) => {
        const credential = await connections.requireCredential(definition.id, signal);
        const query = request.url.indexOf('?');
        return await requestPluginGateway(
          definition,
          credential.accessToken,
          request.params['*'],
          query < 0 ? '' : request.url.slice(query),
          signal,
          services.pluginGatewayFetch,
        );
      });
      return reply.code(result.statusCode).type(result.contentType).send(result.body);
    },
  );
}
