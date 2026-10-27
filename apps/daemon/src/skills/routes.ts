import { Type } from 'typebox';
import {
  SkillControlInputSchema,
  SkillResourceReadSchema,
  SkillResourceContentSchema,
  type SkillResourceRead,
  SkillCreateInputSchema,
  SkillDetailSchema,
  SkillInstallInputSchema,
  SkillViewSchema,
  type SkillControlInput,
  type SkillCreateInput,
  type SkillInstallInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import type { SkillsService } from './service.js';
import { requestOperation } from '../http/request-operation.js';

const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const Query = Type.Object(
  { workspaceId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })) },
  { additionalProperties: false },
);
const Version = Type.Object(
  { contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
  { additionalProperties: false },
);
const ok = Type.Object({ ok: Type.Literal(true) });
/** All Skill endpoints are registered behind the application's existing auth and CSRF hooks. */
export function registerSkillRoutes(server: FastifyInstance, skills: SkillsService): void {
  server.get<{ Querystring: { workspaceId?: string } }>(
    '/api/skills',
    { schema: { querystring: Query, response: { 200: Type.Array(SkillViewSchema) } } },
    async (request, reply) =>
      await requestOperation(
        request,
        reply,
        async (signal) => await skills.list(request.query.workspaceId ?? null, signal),
        null,
        'writableFinished',
      ),
  );
  server.get<{ Params: { id: string }; Querystring: { workspaceId?: string } }>(
    '/api/skills/:id',
    { schema: { params: Params, querystring: Query, response: { 200: SkillDetailSchema } } },
    async (request, reply) =>
      await requestOperation(
        request,
        reply,
        async (signal) =>
          await skills.detail(request.params.id, request.query.workspaceId ?? null, signal),
        null,
        'writableFinished',
      ),
  );
  server.post<{ Body: SkillCreateInput }>(
    '/api/skills',
    { schema: { body: SkillCreateInputSchema, response: { 200: SkillViewSchema } } },
    async (request, reply) =>
      await requestOperation(
        request,
        reply,
        async (signal) => await skills.create(request.body, signal),
        null,
        'writableFinished',
      ),
  );
  server.post<{ Body: SkillInstallInput }>(
    '/api/skills/install',
    { schema: { body: SkillInstallInputSchema, response: { 200: SkillViewSchema } } },
    async (request, reply) =>
      await requestOperation(
        request,
        reply,
        async (signal) => await skills.install(request.body, signal),
        null,
        'writableFinished',
      ),
  );
  server.post<{
    Params: { id: string };
    Querystring: { workspaceId?: string };
    Body: SkillControlInput;
  }>(
    '/api/skills/:id/control',
    {
      schema: {
        params: Params,
        querystring: Query,
        body: SkillControlInputSchema,
        response: { 200: SkillViewSchema },
      },
    },
    async (request, reply) =>
      await requestOperation(
        request,
        reply,
        async (signal) =>
          await skills.control(
            request.params.id,
            request.query.workspaceId ?? null,
            request.body.contentHash,
            request.body.enabled,
            signal,
          ),
        null,
        'writableFinished',
      ),
  );
  server.delete<{
    Params: { id: string };
    Querystring: { workspaceId?: string };
    Body: { contentHash: string };
  }>(
    '/api/skills/:id',
    { schema: { params: Params, querystring: Query, body: Version, response: { 200: ok } } },
    async (request, reply) => {
      await requestOperation(
        request,
        reply,
        async (signal) =>
          await skills.remove(
            request.params.id,
            request.query.workspaceId ?? null,
            request.body.contentHash,
            signal,
          ),
        null,
        'writableFinished',
      );
      return { ok: true as const };
    },
  );
  server.post<{
    Params: { id: string };
    Querystring: { workspaceId?: string };
    Body: SkillResourceRead;
  }>(
    '/api/skills/:id/resources/read',
    {
      schema: {
        params: Params,
        querystring: Query,
        body: SkillResourceReadSchema,
        response: { 200: SkillResourceContentSchema },
      },
    },
    async (request, reply) =>
      await requestOperation(
        request,
        reply,
        async (signal) =>
          await skills.readResource(
            request.params.id,
            request.query.workspaceId ?? null,
            request.body.contentHash,
            request.body.path,
            signal,
          ),
        null,
        'writableFinished',
      ),
  );
  server.post<{ Params: { id: string }; Querystring: { workspaceId?: string } }>(
    '/api/skills/:id/directory',
    {
      schema: {
        params: Params,
        querystring: Query,
        response: { 200: Type.Object({ path: Type.String() }, { additionalProperties: false }) },
      },
    },
    async (request, reply) => ({
      path: await requestOperation(
        request,
        reply,
        async (signal) =>
          await skills.resolveDirectory(
            request.params.id,
            request.query.workspaceId ?? null,
            signal,
          ),
        null,
        'writableFinished',
      ),
    }),
  );
}
