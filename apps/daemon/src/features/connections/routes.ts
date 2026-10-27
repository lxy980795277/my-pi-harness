import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  ConnectionControlSchema,
  ConnectionInputSchema,
  ConnectionUpdateSchema,
  ConnectionSecretInputSchema,
  ConnectionViewSchema,
  ConnectionProviderViewSchema,
  ConnectionServiceIdSchema,
  type ConnectionControl,
  type ConnectionInput,
  type ConnectionUpdate,
  type ConnectionSecretInput,
  type ConnectionServiceId,
} from '@my-pi-harness/protocol';
import type { ConnectionService } from './service.js';
import { requestOperation } from '../request-operation.js';
const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const ok = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });

/** All writes use the application CSRF/auth hooks; OAuth callback has one-use provider/state binding. */
export function registerConnectionRoutes(
  server: FastifyInstance,
  connections: ConnectionService,
): void {
  server.get(
    '/api/connections/providers',
    { schema: { response: { 200: Type.Array(ConnectionProviderViewSchema) } } },
    () => connections.providers(),
  );
  server.get(
    '/api/connections',
    { schema: { response: { 200: Type.Array(ConnectionViewSchema) } } },
    () => connections.list(),
  );
  server.post<{ Body: ConnectionInput }>(
    '/api/connections',
    { schema: { body: ConnectionInputSchema, response: { 200: ConnectionViewSchema } } },
    (request) => connections.create(request.body),
  );
  server.get<{ Params: { id: string } }>(
    '/api/connections/:id',
    { schema: { params: Params, response: { 200: ConnectionViewSchema } } },
    (request) => connections.get(request.params.id),
  );
  server.put<{ Params: { id: string }; Body: ConnectionUpdate }>(
    '/api/connections/:id',
    {
      schema: {
        params: Params,
        body: ConnectionUpdateSchema,
        response: { 200: ConnectionViewSchema },
      },
    },
    (request) => connections.update(request.params.id, request.body),
  );
  server.delete<{ Params: { id: string }; Body: ConnectionControl }>(
    '/api/connections/:id',
    { schema: { params: Params, body: ConnectionControlSchema, response: { 200: ok } } },
    async (request) => {
      await connections.remove(request.params.id, request.body);
      return { ok: true as const };
    },
  );
  server.post<{ Params: { id: string }; Body: ConnectionSecretInput }>(
    '/api/connections/:id/client-secret',
    {
      schema: {
        params: Params,
        body: ConnectionSecretInputSchema,
        response: { 200: ConnectionViewSchema },
      },
    },
    (request) => connections.writeClientSecret(request.params.id, request.body),
  );
  server.post<{ Params: { id: string }; Body: ConnectionSecretInput }>(
    '/api/connections/:id/token',
    {
      schema: {
        params: Params,
        body: ConnectionSecretInputSchema,
        response: { 200: ConnectionViewSchema },
      },
    },
    (request, reply) =>
      requestOperation(request, reply, (signal) =>
        connections.writeToken(request.params.id, request.body, signal),
      ),
  );
  server.post<{ Params: { id: string }; Body: ConnectionControl }>(
    '/api/connections/:id/disconnect',
    {
      schema: {
        params: Params,
        body: ConnectionControlSchema,
        response: { 200: ConnectionViewSchema },
      },
    },
    (request) => connections.disconnect(request.params.id, request.body),
  );
  server.post<{ Params: { id: string }; Body: ConnectionControl }>(
    '/api/connections/:id/oauth/start',
    {
      schema: {
        params: Params,
        body: ConnectionControlSchema,
        response: {
          200: Type.Object(
            { url: Type.String(), expiresAt: Type.Integer() },
            { additionalProperties: false },
          ),
        },
      },
    },
    async (request, reply) => {
      const address = server.server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Daemon address is unavailable');
      const connection = connections.get(request.params.id);
      const redirectUrl = `http://127.0.0.1:${String(address.port)}/api/connections/oauth/callback/${connection.serviceId}`;
      return await requestOperation(request, reply, (signal) =>
        connections.beginOAuth(request.params.id, request.body, redirectUrl, signal),
      );
    },
  );
  server.post<{ Params: { id: string }; Body: ConnectionControl }>(
    '/api/connections/:id/oauth/cancel',
    { schema: { params: Params, body: ConnectionControlSchema, response: { 200: ok } } },
    (request) => {
      connections.get(request.params.id);
      connections.cancelOAuth(request.params.id, request.body);
      return { ok: true as const };
    },
  );
  server.get<{
    Params: { serviceId: ConnectionServiceId };
    Querystring: {
      state?: string;
      code?: string;
      iss?: string;
      error?: string;
      error_description?: string;
      scope?: string;
      authuser?: string;
      prompt?: string;
      session_state?: string;
    };
  }>(
    '/api/connections/oauth/callback/:serviceId',
    {
      schema: {
        params: Type.Object(
          { serviceId: ConnectionServiceIdSchema },
          { additionalProperties: false },
        ),
        querystring: Type.Object(
          {
            state: Type.Optional(Type.String({ maxLength: 256 })),
            code: Type.Optional(Type.String({ maxLength: 4096 })),
            iss: Type.Optional(Type.String({ maxLength: 8192 })),
            error: Type.Optional(Type.String({ maxLength: 256 })),
            error_description: Type.Optional(Type.String({ maxLength: 4096 })),
            scope: Type.Optional(Type.String({ maxLength: 8192 })),
            authuser: Type.Optional(Type.String({ maxLength: 100 })),
            prompt: Type.Optional(Type.String({ maxLength: 100 })),
            session_state: Type.Optional(Type.String({ maxLength: 1000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(request.query))
        if (value !== undefined) params.set(name, value);
      await requestOperation(request, reply, async (signal) => {
        await connections.completeOAuth(request.params.serviceId, params, signal);
      });
      return reply.type('text/plain; charset=utf-8').send('账户授权完成，请返回应用刷新连接状态。');
    },
  );
}
