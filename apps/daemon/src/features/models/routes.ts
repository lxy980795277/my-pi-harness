import {
  AuthFlowSchema,
  ConnectionResultSchema,
  ModelInfoSchema,
  AppSettingsSchema,
  AppSettingsInputSchema,
  NativeProviderInfoSchema,
  ProviderConfigSchema,
  ProviderInputSchema,
  type ProviderInput,
  type AppSettingsInput,
} from '@my-pi-harness/protocol';
import type { ModelGateway } from '@my-pi-harness/agent-runtime';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { GitHubAuth } from '../auth/github-auth.js';
import type { ProviderAuthInput } from './types.js';

const IdParams = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const OkSchema = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });

/** Route validated public model settings into the provider gateway. */
export function registerModelRoutes(
  server: FastifyInstance,
  gateway: ModelGateway,
  github?: GitHubAuth,
): void {
  server.get(
    '/api/providers/catalog',
    { schema: { response: { 200: Type.Array(NativeProviderInfoSchema) } } },
    () => gateway.listBuiltinProviders(),
  );
  server.get(
    '/api/providers',
    { schema: { response: { 200: Type.Array(ProviderConfigSchema) } } },
    () => gateway.listProviders(),
  );
  server.get<{ Params: { id: string } }>(
    '/api/providers/:id',
    { schema: { params: IdParams, response: { 200: ProviderConfigSchema } } },
    (request) => gateway.getProvider(request.params.id),
  );
  server.get('/api/settings', { schema: { response: { 200: AppSettingsSchema } } }, () =>
    gateway.getSettings(),
  );
  server.put<{ Body: AppSettingsInput }>(
    '/api/settings',
    {
      schema: { body: AppSettingsInputSchema, response: { 200: AppSettingsSchema } },
    },
    (request) => gateway.saveSettings(request.body),
  );
  server.put<{ Params: { id: string }; Body: { enabled: boolean; expectedRevision: number } }>(
    '/api/providers/:id/enabled',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          { enabled: Type.Boolean(), expectedRevision: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false },
        ),
        response: { 200: ProviderConfigSchema },
      },
    },
    (request) =>
      gateway.setEnabled(request.params.id, request.body.enabled, request.body.expectedRevision),
  );
  server.post<{ Body: ProviderInput }>(
    '/api/providers',
    { schema: { body: ProviderInputSchema, response: { 200: ProviderConfigSchema } } },
    (request) => gateway.saveProvider(request.body),
  );
  server.put<{ Params: { id: string }; Body: ProviderInput }>(
    '/api/providers/:id',
    {
      schema: {
        params: IdParams,
        body: ProviderInputSchema,
        response: { 200: ProviderConfigSchema },
      },
    },
    (request, reply) => {
      if (request.body.id !== undefined && request.body.id !== request.params.id)
        return reply
          .code(400)
          .send({ code: 'PROVIDER_ID_MISMATCH', message: '模型配置 ID 不一致。' });
      return gateway.saveProvider({ ...request.body, id: request.params.id });
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/api/providers/:id',
    { schema: { params: IdParams, response: { 200: OkSchema } } },
    async (request) => {
      await gateway.deleteProvider(request.params.id);
      return { ok: true };
    },
  );
  server.get<{ Params: { id: string } }>(
    '/api/providers/:id/models',
    { schema: { params: IdParams, response: { 200: Type.Array(ModelInfoSchema) } } },
    (request) => gateway.listModels(request.params.id),
  );
  server.post<{ Params: { id: string }; Body: { key: string } }>(
    '/api/providers/:id/key',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          { key: Type.String({ minLength: 1, maxLength: 16_384 }) },
          { additionalProperties: false },
        ),
        response: { 200: ProviderConfigSchema },
      },
    },
    (request) => gateway.setApiKey(request.params.id, request.body.key),
  );
  server.delete<{ Params: { id: string } }>(
    '/api/providers/:id/key',
    { schema: { params: IdParams, response: { 200: OkSchema } } },
    async (request) => {
      await gateway.clearCredential(request.params.id);
      return { ok: true };
    },
  );
  server.post<{ Params: { id: string }; Body: { modelId: string } }>(
    '/api/providers/:id/test',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          { modelId: Type.String({ minLength: 1, maxLength: 160 }) },
          { additionalProperties: false },
        ),
        response: { 200: ConnectionResultSchema },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      const disconnected = (): void => {
        controller.abort();
      };
      reply.raw.once('close', disconnected);
      try {
        return await gateway.testConnection(
          request.params.id,
          request.body.modelId,
          controller.signal,
        );
      } finally {
        reply.raw.removeListener('close', disconnected);
      }
    },
  );
  server.post<{ Params: { id: string }; Body: ProviderAuthInput }>(
    '/api/providers/:id/auth',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          { kind: Type.Union([Type.Literal('api_key'), Type.Literal('oauth')]) },
          { additionalProperties: false },
        ),
        response: { 200: AuthFlowSchema },
      },
    },
    (request) => gateway.startAuth(request.params.id, request.body.kind),
  );
  server.post<{ Params: { id: string } }>(
    '/api/providers/:id/logout',
    {
      schema: {
        params: IdParams,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: OkSchema },
      },
    },
    async (request) => {
      await gateway.logout(request.params.id);
      return { ok: true };
    },
  );
  server.get(
    '/api/auth-flows',
    { schema: { response: { 200: Type.Array(AuthFlowSchema) } } },
    () => [...gateway.listAuth(), ...(github?.list() ?? [])],
  );
  server.get<{ Params: { id: string } }>(
    '/api/auth-flows/:id',
    { schema: { params: IdParams, response: { 200: AuthFlowSchema } } },
    (request) =>
      github?.owns(request.params.id)
        ? github.get(request.params.id)
        : gateway.getAuth(request.params.id),
  );
  server.post<{ Params: { id: string }; Body: { promptId: string; value: string } }>(
    '/api/auth-flows/:id/respond',
    {
      schema: {
        params: IdParams,
        body: Type.Object(
          {
            promptId: Type.String({ minLength: 1, maxLength: 160 }),
            value: Type.String({ maxLength: 16_384 }),
          },
          { additionalProperties: false },
        ),
        response: { 200: AuthFlowSchema },
      },
    },
    (request) => gateway.respondAuth(request.params.id, request.body.promptId, request.body.value),
  );
  server.delete<{ Params: { id: string } }>(
    '/api/auth-flows/:id',
    { schema: { params: IdParams, response: { 200: AuthFlowSchema } } },
    (request) =>
      github?.owns(request.params.id)
        ? github.cancel(request.params.id)
        : gateway.cancelAuth(request.params.id),
  );
}
