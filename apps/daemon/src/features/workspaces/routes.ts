import {
  WorkspaceCreateInputSchema,
  WorkspaceRenameInputSchema,
  WorkspaceSchema,
  type WorkspaceCreateInput,
  type WorkspaceRenameInput,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { WorkspaceService } from './service.js';

const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);

/** Protected metadata operations never create or remove directories on disk. */
export function registerWorkspaceRoutes(
  server: FastifyInstance,
  workspaces: WorkspaceService,
): void {
  server.get(
    '/api/workspaces',
    { schema: { response: { 200: Type.Array(WorkspaceSchema) } } },
    () => workspaces.list(),
  );
  server.get<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    { schema: { params: Params, response: { 200: WorkspaceSchema } } },
    (request) => workspaces.get(request.params.id),
  );
  server.post<{ Body: WorkspaceCreateInput }>(
    '/api/workspaces',
    { schema: { body: WorkspaceCreateInputSchema, response: { 200: WorkspaceSchema } } },
    (request) => workspaces.create(request.body),
  );
  server.put<{ Params: { id: string }; Body: WorkspaceRenameInput }>(
    '/api/workspaces/:id',
    {
      schema: {
        params: Params,
        body: WorkspaceRenameInputSchema,
        response: { 200: WorkspaceSchema },
      },
    },
    (request) => workspaces.rename(request.params.id, request.body),
  );
  server.delete<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    {
      schema: {
        params: Params,
        response: { 200: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }) },
      },
    },
    (request) => {
      workspaces.archive(request.params.id);
      return { ok: true };
    },
  );
}
