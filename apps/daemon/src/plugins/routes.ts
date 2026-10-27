import { Type } from 'typebox';
import {
  PluginControlInputSchema,
  PluginRemoveInputSchema,
  PluginViewSchema,
  PluginDetailSchema,
  type PluginControlInput,
  type PluginRemoveInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import type { PluginService } from './service.js';
import { requestOperation } from '../http/request-operation.js';
const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const ComponentParams = Type.Object(
  { ...Params.properties, componentId: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
/** Built-in installation exposes finite manifests and never evaluates remote plugin code. */
export function registerPluginRoutes(server: FastifyInstance, plugins: PluginService): void {
  server.get('/api/plugins', { schema: { response: { 200: Type.Array(PluginViewSchema) } } }, () =>
    plugins.list(),
  );
  server.get<{ Params: { id: string } }>(
    '/api/plugins/:id',
    {
      schema: {
        params: Params,
        querystring: Type.Object({}, { additionalProperties: false }),
        response: { 200: PluginDetailSchema },
      },
    },
    (request, reply) =>
      requestOperation(request, reply, (signal) => plugins.detail(request.params.id, signal), null),
  );
  server.post<{ Params: { id: string } }>(
    '/api/plugins/:id/install',
    { schema: { params: Params, response: { 200: PluginViewSchema } } },
    (request, reply) =>
      requestOperation(
        request,
        reply,
        (signal) => plugins.install(request.params.id, signal),
        null,
      ),
  );
  server.post<{ Params: { id: string }; Body: PluginControlInput }>(
    '/api/plugins/:id/control',
    {
      schema: {
        params: Params,
        body: PluginControlInputSchema,
        response: { 200: PluginViewSchema },
      },
    },
    async (request) =>
      await plugins.control(request.params.id, request.body.expectedRevision, request.body.enabled),
  );
  server.post<{ Params: { id: string; componentId: string }; Body: PluginControlInput }>(
    '/api/plugins/:id/components/:componentId',
    {
      schema: {
        params: ComponentParams,
        body: PluginControlInputSchema,
        response: { 200: PluginViewSchema },
      },
    },
    async (request) =>
      await plugins.component(
        request.params.id,
        request.params.componentId,
        request.body.expectedRevision,
        request.body.enabled,
      ),
  );
  server.delete<{ Params: { id: string }; Body: PluginRemoveInput }>(
    '/api/plugins/:id',
    {
      schema: {
        params: Params,
        body: PluginRemoveInputSchema,
        response: { 200: Type.Object({ ok: Type.Literal(true) }) },
      },
    },
    async (request) => {
      await plugins.remove(request.params.id, request.body.expectedRevision);
      return { ok: true as const };
    },
  );
}
