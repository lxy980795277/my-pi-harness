import {
  MemoryCreateInputSchema,
  MemoryPageSchema,
  MemoryModeSchema,
  MemoryCategorySchema,
  MemoryCurrentStatusSchema,
  MemoryStatusInputSchema,
  MemoryForgetInputSchema,
  MemoryMutationResultSchema,
  MemorySettingsInputSchema,
  MemorySettingsSchema,
  MemoryUpdateInputSchema,
  MemoryUsageSchema,
  type MemoryCreateInput,
  type MemoryForgetInput,
  type MemoryScope,
  type MemoryMode,
  type MemoryCategory,
  type MemoryStatusInput,
  type MemorySettingsInput,
  type MemoryUpdateInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { MemoryApplicationService } from './service';

interface MemoryQuery {
  scope?: 'user' | 'workspace';
  workspaceId?: string;
  mode?: MemoryMode;
  category?: MemoryCategory;
  enabled?: 'true' | 'false';
  cursor?: string;
  limit?: string;
}

const id = Type.String({ minLength: 1, maxLength: 160 });
const IdParams = Type.Object({ id }, { additionalProperties: false });
const result = { 200: MemoryMutationResultSchema };

function scope(query: MemoryQuery): MemoryScope | undefined {
  if (query.scope === 'user' && query.workspaceId === undefined) return { kind: 'user' };
  if (query.scope === 'workspace' && query.workspaceId !== undefined)
    return { kind: 'workspace', workspaceId: query.workspaceId };
  if (query.scope === undefined && query.workspaceId === undefined) return undefined;
  throw new RuntimeError('MEMORY_SCOPE_INVALID', '请选择有效记忆范围。');
}

/** Application access hooks own authentication and CSRF for every memory route. */
export function registerMemoryRoutes(
  server: FastifyInstance,
  memory: MemoryApplicationService,
  store: ProfileStore,
): void {
  server.get<{ Querystring: MemoryQuery }>(
    '/api/memories',
    {
      schema: {
        querystring: Type.Object(
          {
            scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('workspace')])),
            workspaceId: Type.Optional(id),
            mode: Type.Optional(MemoryModeSchema),
            category: Type.Optional(MemoryCategorySchema),
            enabled: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
            cursor: Type.Optional(id),
            limit: Type.Optional(Type.String({ pattern: '^([1-9]|[1-9][0-9]|100)$' })),
          },
          { additionalProperties: false },
        ),
        response: { 200: MemoryPageSchema },
      },
    },
    (request) => {
      const selected = scope(request.query);
      return memory.list({
        ...(selected === undefined ? {} : { scope: selected }),
        ...(request.query.mode === undefined ? {} : { mode: request.query.mode }),
        ...(request.query.category === undefined ? {} : { category: request.query.category }),
        ...(request.query.enabled === undefined
          ? {}
          : { enabled: request.query.enabled === 'true' }),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
      });
    },
  );
  server.post<{ Body: MemoryStatusInput }>(
    '/api/memories/statuses',
    {
      schema: {
        body: MemoryStatusInputSchema,
        response: { 200: Type.Array(MemoryCurrentStatusSchema, { maxItems: 128 }) },
      },
    },
    (request) => memory.statuses(request.body.ids),
  );
  server.post<{ Body: MemoryCreateInput }>(
    '/api/memories',
    {
      schema: { body: MemoryCreateInputSchema, response: result },
    },
    async (request) => await memory.create(request.body),
  );
  server.patch<{ Params: { id: string }; Body: MemoryUpdateInput }>(
    '/api/memories/:id',
    {
      schema: { params: IdParams, body: MemoryUpdateInputSchema, response: result },
    },
    (request) => memory.update(request.params.id, request.body),
  );
  server.delete<{ Params: { id: string }; Body: MemoryForgetInput }>(
    '/api/memories/:id',
    {
      schema: { params: IdParams, body: MemoryForgetInputSchema, response: result },
    },
    (request) => memory.forget(request.params.id, request.body),
  );
  server.get('/api/memory-settings', { schema: { response: { 200: MemorySettingsSchema } } }, () =>
    memory.settings(),
  );
  server.put<{ Body: MemorySettingsInput }>(
    '/api/memory-settings',
    {
      schema: { body: MemorySettingsInputSchema, response: { 200: MemorySettingsSchema } },
    },
    (request) => memory.updateSettings(request.body),
  );
  server.get<{ Params: { id: string; runId: string } }>(
    '/api/sessions/:id/runs/:runId/memory-usage',
    {
      schema: {
        params: Type.Object({ id, runId: id }, { additionalProperties: false }),
        response: { 200: Type.Union([MemoryUsageSchema, Type.Null()]) },
      },
    },
    (request) => store.getMemoryUsage(request.params.id, request.params.runId),
  );
}
