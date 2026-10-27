import {
  EditInputSchema,
  InputRequestSchema,
  QueuePatchInputSchema,
  SessionCreateInputSchema,
  SessionPatchInputSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
  type EditInput,
  type InputRequest,
  type QueuePatchInput,
  type SessionCreateInput,
  type SessionPatchInput,
} from '@my-pi-harness/protocol';
import type { ModelGateway, SessionRuntime } from '@my-pi-harness/agent-runtime';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { LocalAuth } from '../auth/local-auth.js';
import type { WorkspaceService } from '../workspaces/service.js';
import { registerSessionStreamRoute } from './stream-route.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const IdParams = Type.Object({ id }, { additionalProperties: false });
const EmptySchema = Type.Object({}, { additionalProperties: false });
const SnapshotReply = { 200: SessionSnapshotSchema };

/** Authorize private session facts and expose only validated protocol projections. */
export function registerSessionRoutes(
  server: FastifyInstance,
  runtime: SessionRuntime,
  auth: LocalAuth,
  gateway: ModelGateway,
  workspaces: WorkspaceService,
): void {
  registerSessionStreamRoute(server, runtime, auth);
  server.get(
    '/api/sessions',
    { schema: { response: { 200: Type.Array(SessionSummarySchema) } } },
    () => runtime.listSessions(),
  );
  server.post<{ Body: SessionCreateInput }>(
    '/api/sessions',
    { schema: { body: SessionCreateInputSchema, response: SnapshotReply } },
    async (request) =>
      runtime.getSnapshot(
        runtime.createSession(
          await gateway.resolveSessionInput(await workspaces.resolveSessionInput(request.body)),
        ).id,
      ),
  );
  server.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    {
      schema: {
        params: IdParams,
        response: { 200: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }) },
      },
    },
    async (request) => {
      await runtime.deleteSession(request.params.id);
      return { ok: true };
    },
  );
  server.get<{ Params: { id: string } }>(
    '/api/sessions/:id',
    { schema: { params: IdParams, response: SnapshotReply } },
    (request) => runtime.getSnapshot(request.params.id),
  );
  server.put<{ Params: { id: string }; Body: SessionPatchInput }>(
    '/api/sessions/:id',
    { schema: { params: IdParams, body: SessionPatchInputSchema, response: SnapshotReply } },
    (request) => runtime.updateSession(request.params.id, request.body),
  );
  server.post<{ Params: { id: string }; Body: InputRequest }>(
    '/api/sessions/:id/inputs',
    { schema: { params: IdParams, body: InputRequestSchema, response: SnapshotReply } },
    async (request) => {
      await runtime.send(request.params.id, request.body);
      return runtime.getSnapshot(request.params.id);
    },
  );
  server.post<{ Params: { id: string } }>(
    '/api/sessions/:id/stop',
    { schema: { params: IdParams, body: EmptySchema, response: SnapshotReply } },
    (request) => runtime.cancel(request.params.id),
  );
  server.post<{ Params: { id: string } }>(
    '/api/sessions/:id/queue/resume',
    { schema: { params: IdParams, body: EmptySchema, response: SnapshotReply } },
    async (request) => {
      await runtime.resumeQueue(request.params.id);
      return runtime.getSnapshot(request.params.id);
    },
  );
  server.put<{ Params: { id: string; inputId: string }; Body: QueuePatchInput }>(
    '/api/sessions/:id/queue/:inputId',
    {
      schema: {
        params: Type.Object({ id, inputId: id }, { additionalProperties: false }),
        body: QueuePatchInputSchema,
        response: SnapshotReply,
      },
    },
    (request) => runtime.updateQueue(request.params.id, request.params.inputId, request.body),
  );
  server.delete<{ Params: { id: string; inputId: string } }>(
    '/api/sessions/:id/queue/:inputId',
    {
      schema: {
        params: Type.Object({ id, inputId: id }, { additionalProperties: false }),
        response: SnapshotReply,
      },
    },
    (request) => runtime.deleteQueue(request.params.id, request.params.inputId),
  );
  server.post<{ Params: { id: string }; Body: EditInput }>(
    '/api/sessions/:id/edit',
    { schema: { params: IdParams, body: EditInputSchema, response: SnapshotReply } },
    async (request) => {
      await runtime.editAndResend(request.params.id, request.body);
      return runtime.getSnapshot(request.params.id);
    },
  );
  server.post<{ Params: { id: string; branchId: string } }>(
    '/api/sessions/:id/branches/:branchId/select',
    {
      schema: {
        params: Type.Object({ id, branchId: id }, { additionalProperties: false }),
        body: EmptySchema,
        response: SnapshotReply,
      },
    },
    (request) => runtime.selectBranch(request.params.id, request.params.branchId),
  );
}
