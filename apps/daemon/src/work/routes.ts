import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import {
  CheckpointCreateSchema,
  ContextResetSchema,
  QuestionAnswerSchema,
  PlanReviewSchema,
  RuleSourceSchema,
  WorkPatchSchema,
  WorkSnapshotSchema,
  type CheckpointCreate,
  type ContextReset,
  type WorkPatch,
  type QuestionAnswer,
  type PlanReview,
} from '@my-pi-harness/protocol';
import type { WorkRuntime } from '@my-pi-harness/agent-runtime';
import { requestOperation } from '../http/request-operation.js';

interface SessionParams {
  sessionId: string;
}

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
    (request, reply) =>
      requestOperation(
        request,
        reply,
        (signal) => work.compact(request.params.sessionId, request.body, signal),
        null,
      ),
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
    '/api/sessions/:sessionId/work/reset-context',
    {
      schema: {
        params: sessionParams,
        body: ContextResetSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.reset(request.params.sessionId, request.body),
  );
  server.post<{ Params: SessionParams; Body: ContextReset }>(
    '/api/sessions/:sessionId/work/reset-tasks',
    {
      schema: {
        params: sessionParams,
        body: ContextResetSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.resetTasks(request.params.sessionId, request.body),
  );
  server.post<{ Params: SessionParams & { planId: string }; Body: PlanReview }>(
    '/api/sessions/:sessionId/work/plans/:planId/review',
    {
      schema: {
        params: Type.Object(
          {
            sessionId: Type.String({ minLength: 1, maxLength: 160 }),
            planId: Type.String({ minLength: 1, maxLength: 160 }),
          },
          { additionalProperties: false },
        ),
        body: PlanReviewSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => work.reviewPlan(request.params.sessionId, request.params.planId, request.body),
  );
  server.post<{ Params: SessionParams & { compactionId: string }; Body: ContextReset }>(
    '/api/sessions/:sessionId/work/compactions/:compactionId/select',
    {
      schema: {
        params: Type.Object(
          {
            sessionId: Type.String({ minLength: 1, maxLength: 160 }),
            compactionId: Type.String({ minLength: 1, maxLength: 160 }),
          },
          { additionalProperties: false },
        ),
        body: ContextResetSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) =>
      work.selectCompaction(request.params.sessionId, request.params.compactionId, request.body),
  );
  server.post<{ Params: SessionParams & { questionId: string }; Body: QuestionAnswer }>(
    '/api/sessions/:sessionId/questions/:questionId/answer',
    {
      schema: {
        params: questionParams,
        body: QuestionAnswerSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) =>
      work.answer(request.params.sessionId, request.params.questionId, request.body.answers),
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
