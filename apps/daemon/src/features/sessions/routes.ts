import type { ServerResponse } from 'node:http';
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
import type { ProfileStore } from '@my-pi-harness/storage';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { LocalAuth } from '../auth/local-auth.js';
import type { WorkspaceService } from '../workspaces/service.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const IdParams = Type.Object({ id }, { additionalProperties: false });
const EmptySchema = Type.Object({}, { additionalProperties: false });
const SnapshotReply = { 200: SessionSnapshotSchema };

/** Authorize private session facts and expose only validated protocol projections. */
export function registerSessionRoutes(
  server: FastifyInstance,
  runtime: SessionRuntime,
  store: ProfileStore,
  auth: LocalAuth,
  gateway: ModelGateway,
  workspaces: WorkspaceService,
): void {
  const live = new Set<ServerResponse>();
  server.addHook('preClose', (done) => {
    for (const response of live) response.end();
    done();
  });
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
  server.get<{ Params: { id: string }; Querystring: { afterSeq?: string } }>(
    '/api/sessions/:id/events',
    {
      exposeHeadRoute: false,
      schema: {
        params: IdParams,
        querystring: Type.Object(
          { afterSeq: Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,14})$' })) },
          { additionalProperties: false },
        ),
      },
    },
    (request, reply) => {
      const sessionId = request.params.id;
      const snapshot = runtime.getSnapshot(sessionId);
      let seq = Number(request.query.afterSeq ?? '0');
      if (seq > snapshot.snapshotSeq)
        return reply
          .code(409)
          .send({ code: 'EVENT_CURSOR_INVALID', message: '事件游标超过已提交序列。' });
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      live.add(response);
      let stopped = false;
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = (): void => undefined;
      let unwatch = (): void => undefined;
      const cleanup = (): void => {
        if (stopped) return;
        stopped = true;
        live.delete(response);
        unsubscribe();
        unwatch();
        clearTimeout(flushTimer);
        clearInterval(heartbeat);
      };
      response.once('close', cleanup);
      const write = (event: string, data: unknown, eventSeq: number): boolean => {
        if (stopped || !auth.isAuthorized(request)) {
          response.end();
          return false;
        }
        const record = `event: ${event}\nid: ${eventSeq}\ndata: ${JSON.stringify(data)}\n\n`;
        if (Buffer.byteLength(record) > 8 * 1024 * 1024 || !response.write(record)) {
          response.end();
          return false;
        }
        return true;
      };
      const flush = (): void => {
        flushTimer = undefined;
        try {
          let events = store.readEvents(sessionId, seq, 1000);
          while (events.length) {
            for (const event of events) {
              if (!write('session.event', event, event.seq)) return;
              seq = event.seq;
            }
            events = store.readEvents(sessionId, seq, 1000);
          }
          write('session.snapshot', runtime.getSnapshot(sessionId), seq);
        } catch {
          response.end();
        }
      };
      // Subscription precedes the synchronous high-water read; committed events cannot fall into a gap.
      unsubscribe = runtime.subscribe(sessionId, () => {
        flushTimer ??= setTimeout(flush, 32);
      });
      const heartbeat = setInterval(() => {
        if (!auth.isAuthorized(request) || !response.write(': heartbeat\n\n')) response.end();
      }, 15_000);
      unwatch = auth.watch(request, () => response.end());
      flush();
      return reply;
    },
  );
}
