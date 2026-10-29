import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  AgentBoardQuerySchema,
  AgentBoardSchema,
  AgentMessageInputSchema,
  AgentSettingsSchema,
  AgentSettingsInputSchema,
  AgentTaskDetailSchema,
  AgentTaskListSchema,
  AgentTaskStopSchema,
  PlanReviewSchema,
  QuestionAnswerSchema,
  WorkSnapshotSchema,
  type AgentBoardQuery,
  type AgentMessageInput,
  type AgentSettingsInput,
  type AgentTaskStop,
  type PlanReview,
  type QuestionAnswer,
  type AgentTaskQuery,
} from '@my-pi-harness/protocol';
import type { ApplicationServices } from '../application/services.js';
import { startAgentChangeStream } from './change-stream.js';

interface SessionParams {
  sessionId: string;
}
interface TaskParams extends SessionParams {
  taskId: string;
}
interface PageQuery {
  cursor?: string;
  limit?: string;
}
type BoardHttpQuery = Omit<AgentBoardQuery, 'cursor' | 'limit'> & PageQuery;

const id = Type.String({ minLength: 1, maxLength: 160 });
const sessionParams = Type.Object({ sessionId: id }, { additionalProperties: false });
const taskParams = Type.Object({ sessionId: id, taskId: id }, { additionalProperties: false });
const questionParams = Type.Object(
  { sessionId: id, taskId: id, questionId: id },
  { additionalProperties: false },
);
const pageProperties = {
  cursor: Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,9})$' })),
  limit: Type.Optional(Type.String({ pattern: '^([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$' })),
};
const pageQuery = Type.Object(pageProperties, { additionalProperties: false });
const boardQuery = Type.Object(
  { ...AgentBoardQuerySchema.properties, ...pageProperties },
  { additionalProperties: false },
);

function page(input: PageQuery): AgentTaskQuery {
  return {
    ...(input.cursor === undefined ? {} : { cursor: Number(input.cursor) }),
    ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
  };
}

/** Task commands use the same application authentication and CSRF rules as root conversations. */
export function registerAgentRoutes(server: FastifyInstance, services: ApplicationServices): void {
  const { runtime, work, auth } = services;
  server.get<{ Querystring: BoardHttpQuery }>(
    '/api/agents',
    { schema: { querystring: boardQuery, response: { 200: AgentBoardSchema } } },
    (request) => {
      const { cursor: _cursor, limit: _limit, ...filters } = request.query;
      return runtime.agents.board({ ...filters, ...page(request.query) });
    },
  );
  server.get('/api/agent-settings', { schema: { response: { 200: AgentSettingsSchema } } }, () =>
    runtime.agents.settings(),
  );
  server.put<{ Body: AgentSettingsInput }>(
    '/api/agent-settings',
    { schema: { body: AgentSettingsInputSchema, response: { 200: AgentSettingsSchema } } },
    (request) => runtime.agents.updateSettings(request.body),
  );
  server.get<{ Params: SessionParams }>(
    '/api/sessions/:sessionId/agents',
    { schema: { params: sessionParams, response: { 200: AgentTaskListSchema } } },
    (request) => runtime.agents.list(request.params.sessionId),
  );
  server.get<{ Params: TaskParams; Querystring: PageQuery }>(
    '/api/sessions/:sessionId/agents/:taskId',
    {
      schema: {
        params: taskParams,
        querystring: pageQuery,
        response: { 200: AgentTaskDetailSchema },
      },
    },
    (request) => {
      const query = page(request.query);
      return runtime.agents.detail(
        request.params.sessionId,
        request.params.taskId,
        query.cursor,
        query.limit,
      );
    },
  );
  server.post<{ Params: TaskParams; Body: AgentTaskStop }>(
    '/api/sessions/:sessionId/agents/:taskId/stop',
    {
      schema: {
        params: taskParams,
        body: AgentTaskStopSchema,
        response: { 200: AgentTaskDetailSchema },
      },
    },
    (request) => runtime.agents.stop(request.params.sessionId, request.params.taskId, request.body),
  );
  server.post<{ Params: TaskParams; Body: AgentMessageInput }>(
    '/api/sessions/:sessionId/agents/:taskId/messages',
    {
      schema: {
        params: taskParams,
        body: AgentMessageInputSchema,
        response: { 200: AgentTaskDetailSchema },
      },
    },
    (request) =>
      runtime.agents.message(request.params.sessionId, request.params.taskId, request.body),
  );
  server.get<{ Params: TaskParams }>(
    '/api/sessions/:sessionId/agents/:taskId/work',
    { schema: { params: taskParams, response: { 200: WorkSnapshotSchema } } },
    (request) => {
      runtime.agents.detail(request.params.sessionId, request.params.taskId, 0, 1);
      return work.snapshot(request.params.sessionId, undefined, request.params.taskId);
    },
  );
  server.post<{ Params: TaskParams & { questionId: string }; Body: QuestionAnswer }>(
    '/api/sessions/:sessionId/agents/:taskId/questions/:questionId/answer',
    {
      schema: {
        params: questionParams,
        body: QuestionAnswerSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => {
      runtime.agents.detail(request.params.sessionId, request.params.taskId, 0, 1);
      return work.answer(
        request.params.sessionId,
        request.params.questionId,
        request.body.answers,
        request.params.taskId,
      );
    },
  );
  server.post<{ Params: TaskParams & { questionId: string } }>(
    '/api/sessions/:sessionId/agents/:taskId/questions/:questionId/cancel',
    {
      schema: {
        params: questionParams,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => {
      runtime.agents.detail(request.params.sessionId, request.params.taskId, 0, 1);
      return work.answer(
        request.params.sessionId,
        request.params.questionId,
        null,
        request.params.taskId,
      );
    },
  );
  server.post<{ Params: TaskParams & { planId: string }; Body: PlanReview }>(
    '/api/sessions/:sessionId/agents/:taskId/plans/:planId/review',
    {
      schema: {
        params: Type.Object(
          { sessionId: id, taskId: id, planId: id },
          { additionalProperties: false },
        ),
        body: PlanReviewSchema,
        response: { 200: WorkSnapshotSchema },
      },
    },
    (request) => {
      runtime.agents.detail(request.params.sessionId, request.params.taskId, 0, 1);
      return work.reviewPlan(
        request.params.sessionId,
        request.params.planId,
        request.body,
        request.params.taskId,
      );
    },
  );
  const connections = new Map<ServerResponse, () => void>();
  server.addHook('preClose', (done) => {
    for (const close of connections.values()) close();
    done();
  });
  server.get(
    '/api/agents/events',
    {
      exposeHeadRoute: false,
      schema: { querystring: Type.Object({}, { additionalProperties: false }) },
    },
    (request, reply) => {
      const agents = runtime.agents;
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const close = startAgentChangeStream({
        response,
        subscribe: (listener) => agents.subscribeChanges(listener),
        authorized: () => auth.isAuthorized(request),
        watchAuthorization: (listener) => auth.watch(request, listener),
        onClose: () => connections.delete(response),
      });
      if (!response.destroyed && !response.writableEnded) connections.set(response, close);
      return reply;
    },
  );
}
