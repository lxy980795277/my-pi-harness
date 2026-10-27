import {
  AttachmentContentSchema,
  AttachmentReferenceSchema,
  AttachmentSchema,
  AttachmentUploadSchema,
  type AttachmentReference,
  type AttachmentUpload,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { AttachmentService } from './service.js';
import { requestOperation } from '../http/request-operation.js';

const Params = Type.Object(
  { attachmentId: Type.String({ minLength: 1, maxLength: 160 }) },
  { additionalProperties: false },
);

/** Registered inside the protected API scope; content is fetched explicitly, never broadcast. */
export function registerAttachmentRoutes(
  server: FastifyInstance,
  attachments: AttachmentService,
): void {
  server.post<{ Body: AttachmentUpload }>(
    '/api/attachments',
    {
      bodyLimit: 12 * 1024 * 1024,
      schema: { body: AttachmentUploadSchema, response: { 200: AttachmentSchema } },
    },
    (request, reply) =>
      requestOperation(
        request,
        reply,
        async (signal) => await attachments.upload(request.body, signal),
        null,
        'always',
      ),
  );
  server.post<{ Body: AttachmentReference }>(
    '/api/attachments/reference',
    {
      schema: { body: AttachmentReferenceSchema, response: { 200: AttachmentSchema } },
    },
    (request, reply) =>
      requestOperation(
        request,
        reply,
        async (signal) => await attachments.reference(request.body, signal),
        null,
        'always',
      ),
  );
  server.get<{ Params: { attachmentId: string } }>(
    '/api/attachments/:attachmentId',
    {
      schema: { params: Params, response: { 200: AttachmentSchema } },
    },
    (request) => attachments.get(request.params.attachmentId).attachment,
  );
  server.get<{ Params: { attachmentId: string } }>(
    '/api/attachments/:attachmentId/content',
    {
      schema: { params: Params, response: { 200: AttachmentContentSchema } },
    },
    (request) => attachments.get(request.params.attachmentId),
  );
  server.get<{ Params: { workspaceId: string }; Querystring: { path?: string } }>(
    '/api/workspaces/:workspaceId/files',
    {
      schema: {
        params: Type.Object(
          { workspaceId: Type.String({ minLength: 1, maxLength: 160 }) },
          { additionalProperties: false },
        ),
        querystring: Type.Object(
          { path: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object(
            { paths: Type.Array(Type.String(), { maxItems: 500 }) },
            { additionalProperties: false },
          ),
        },
      },
    },
    async (request) => ({
      paths: await attachments.listFiles(request.params.workspaceId, request.query.path),
    }),
  );
}
