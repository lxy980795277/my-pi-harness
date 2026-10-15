import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import {
  CheckpointCreateSchema,
  ContextResetSchema,
  QuestionAnswerSchema,
  RuleSourceSchema,
  WorkPatchSchema,
  WorkSnapshotSchema,
  type CheckpointCreate,
  type ContextReset,
  type WorkPatch,
} from '@my-pi-harness/protocol';
import type { WorkRuntime } from '@my-pi-harness/agent-runtime';

const sessionParams = Type.Object(
  { sessionId: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);
const questionParams = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: 160 }),
    questionId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);
const checkpointParams = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: 160 }),
    checkpointId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);
interface SessionParams {
  sessionId: string;
}

/** Work APIs live under the same authenticated, CSRF-protected scope as session commands. */
export function registerWorkRoutes(server: FastifyInstance, work: WorkRuntime): void {
  server.get<{ Params: SessionParams; Querystring: { branchId: string } }>(
    '/api/sessions/:sessionId/work',
    {
      schema: {
        params: sessionParams,
        querystring: Type.Object(
          { branchId: Type.String({ minLength: 1, maxLength: 160 }) },
          { additionalProperties: false },
        ),
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.snapshot(request.params.sessionId, request.query.branchId),
  );
  server.patch<{ Params: SessionParams; Body: WorkPatch }>(
    '/api/sessions/:sessionId/work',
    {
      schema: {
        params: sessionParams,
        body: WorkPatchSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.patch(request.params.sessionId, request.body),
  );
  server.post<{ Params: SessionParams; Body: ContextReset }>(
    '/api/sessions/:sessionId/work/compact',
    {
      schema: {
        params: sessionParams,
        body: ContextResetSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      const close = (): void => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once('aborted', abort);
      reply.raw.once('close', close);
      try {
        return await work.compact(request.params.sessionId, request.body, controller.signal);
      } finally {
        request.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', close);
      }
    },
  );
  server.post<{ Params: SessionParams; Body: CheckpointCreate }>(
    '/api/sessions/:sessionId/work/checkpoints',
    {
      schema: {
        params: sessionParams,
        body: CheckpointCreateSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.createCheckpoint(request.params.sessionId, request.body),
  );
  server.post<{ Params: SessionParams & { checkpointId: string }; Body: ContextReset }>(
    '/api/sessions/:sessionId/work/checkpoints/:checkpointId/restore',
    {
      schema: {
        params: checkpointParams,
        body: ContextResetSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.restore(request.params.sessionId, request.params.checkpointId, request.body),
  );
  server.post<{ Params: SessionParams; Body: ContextReset }>(
    '/api/sessions/:sessionId/work/reset',
    {
      schema: {
        params: sessionParams,
        body: ContextResetSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.reset(request.params.sessionId, request.body),
  );
  server.post<{ Params: SessionParams & { questionId: string }; Body: { answer: string } }>(
    '/api/sessions/:sessionId/questions/:questionId/answer',
    {
      schema: {
        params: questionParams,
        body: QuestionAnswerSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) =>
      work.answer(request.params.sessionId, request.params.questionId, request.body.answer),
  );
  server.post<{ Params: SessionParams & { questionId: string } }>(
    '/api/sessions/:sessionId/questions/:questionId/cancel',
    {
      schema: {
        params: questionParams,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.answer(request.params.sessionId, request.params.questionId, null),
  );
  server.get<{ Params: { workspaceId: string } }>(
    '/api/workspaces/:workspaceId/rules',
    {
      schema: {
        params: Type.Object(
          { workspaceId: Type.String({ minLength: 1, maxLength: 160 }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Array(RuleSourceSchema, { maxItems: 16 }) },
      },
    },
    (request) => work.rules(request.params.workspaceId),
  );
}
