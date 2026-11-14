import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { Type } from 'typebox';
import {
  SessionArchiveJobSchema,
  SessionArchiveJobsPageSchema,
  SessionArchiveImportBindingSchema,
  SessionSummarySchema,
  SessionExecutionAccessSchema,
  type SessionArchiveImportBinding,
} from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';
import { requestOperation } from '../http/request-operation';
import type { SessionArchiveService } from './service';
import { ArchiveError } from './errors';
import { ARCHIVE_LIMITS } from './limits';

interface OperationParams {
  operationId: string;
}
interface SessionParams {
  id: string;
}
interface JobsQuery {
  cursor?: string;
  limit?: string;
}

const id = Type.String({ pattern: '^[A-Za-z0-9_-]{1,160}$' });
const params = Type.Object({ operationId: id }, { additionalProperties: false });
const sessionParams = Type.Object({ id }, { additionalProperties: false });
const exportBody = Type.Object({ operationId: id, sessionId: id }, { additionalProperties: false });
const commitBody = Type.Object(
  { archiveSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
  { additionalProperties: false },
);
const empty = Type.Object({}, { additionalProperties: false });
const query = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    limit: Type.Optional(Type.String({ pattern: '^([1-9]|[1-4][0-9]|50)$' })),
  },
  { additionalProperties: false },
);

/** Transfers use authenticated same-origin streams; only explicit commit can publish uploaded history. */
export function registerSessionArchiveRoutes(
  server: FastifyInstance,
  archives: SessionArchiveService,
  store: ProfileStore,
): void {
  server.addContentTypeParser('application/gzip', (_request, payload, done) => done(null, payload));
  server.get<{ Querystring: JobsQuery }>(
    '/api/session-archives/operations',
    {
      schema: { querystring: query, response: { 200: SessionArchiveJobsPageSchema } },
    },
    (request) =>
      archives.list({
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
      }),
  );
  server.get<{ Params: OperationParams }>(
    '/api/session-archives/operations/:operationId',
    {
      schema: { params, response: { 200: SessionArchiveJobSchema } },
    },
    (request) => archives.get(request.params.operationId),
  );
  server.post<{ Params: OperationParams; Body: Record<string, never> }>(
    '/api/session-archives/operations/:operationId/cancel',
    {
      schema: { params, body: empty, response: { 200: SessionArchiveJobSchema } },
    },
    (request) => archives.cancel(request.params.operationId),
  );
  server.post<{ Body: { operationId: string; sessionId: string } }>(
    '/api/session-archives/exports',
    {
      schema: { body: exportBody, response: { 202: SessionArchiveJobSchema } },
    },
    (request, reply) =>
      reply.code(202).send(archives.export(request.body.operationId, request.body.sessionId)),
  );
  server.get<{ Params: OperationParams }>(
    '/api/session-archives/exports/:operationId/download',
    {
      schema: {
        params,
        querystring: empty,
        response: { 200: Type.String({ description: 'Complete session tar.gz archive' }) },
      },
    },
    (request, reply) => {
      const download = archives.download(request.params.operationId);
      reply.raw.once('close', () => {
        if (!reply.raw.writableFinished) download.content.destroy();
      });
      return reply
        .type('application/gzip')
        .header(
          'Content-Disposition',
          `attachment; filename="session-${request.params.operationId}.tar.gz"`,
        )
        .header('Content-Length', download.bytes)
        .header('X-Content-Type-Options', 'nosniff')
        .send(download.content);
    },
  );
  server.post<{ Params: OperationParams; Body: Readable }>(
    '/api/session-archives/imports/:operationId/upload',
    {
      bodyLimit: ARCHIVE_LIMITS.compressedBytes,
      schema: { params, response: { 200: SessionArchiveJobSchema } },
    },
    async (request, reply) => {
      if (request.headers['content-type'] !== 'application/gzip')
        throw new ArchiveError('ARCHIVE_MEDIA_TYPE', '请上传gzip格式的完整会话归档。', 415);
      const job = await requestOperation(
        request,
        reply,
        (signal) => archives.upload(request.params.operationId, request.body, signal),
        ARCHIVE_LIMITS.operationMs,
      );
      if (job.status === 'failed')
        throw new ArchiveError('ARCHIVE_IMPORT_INVALID', job.error ?? '归档未通过预检。');
      return job;
    },
  );
  server.post<{ Params: OperationParams; Body: { archiveSha256: string } }>(
    '/api/session-archives/imports/:operationId/commit',
    {
      schema: { params, body: commitBody, response: { 202: SessionArchiveJobSchema } },
    },
    (request, reply) =>
      reply.code(202).send(archives.commit(request.params.operationId, request.body.archiveSha256)),
  );
  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/archive-access',
    {
      schema: { params: sessionParams, response: { 200: SessionExecutionAccessSchema } },
    },
    (request) => store.getSessionExecutionAccess(request.params.id),
  );
  server.put<{ Params: SessionParams; Body: SessionArchiveImportBinding }>(
    '/api/sessions/:id/archive-binding',
    {
      schema: {
        params: sessionParams,
        body: SessionArchiveImportBindingSchema,
        response: { 200: SessionSummarySchema },
      },
    },
    (request, reply) =>
      requestOperation(request, reply, (signal) =>
        archives.bind(request.params.id, request.body, signal),
      ),
  );
}
