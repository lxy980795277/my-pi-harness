import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  FileChangesQuerySchema,
  FileChangesPageSchema,
  FileChangeDetailQuerySchema,
  FileChangeDetailSchema,
  FileChangeBatchInputSchema,
  FileChangeBatchReceiptSchema,
  FileChangeBatchPageSchema,
  type FileChangesQuery,
  type FileChangeDetailQuery,
  type FileChangeBatchInput,
} from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { FileChangeBatches } from './batches';

interface SessionParams {
  id: string;
}
interface ChangeParams extends SessionParams {
  changeId: string;
}
interface OperationParams extends SessionParams {
  operationId: string;
}
interface PageQuery {
  cursor?: string;
  limit?: string;
}
type ChangesQuery = Omit<FileChangesQuery, 'cursor' | 'limit'> & PageQuery;
type DetailQuery = Omit<FileChangeDetailQuery, 'offset' | 'maxBytes'> & {
  offset?: string;
  maxBytes?: string;
};

const id = Type.String({ minLength: 1, maxLength: 160 });
const params = Type.Object({ id }, { additionalProperties: false });
const changeParams = Type.Object({ id, changeId: id }, { additionalProperties: false });
const operationParams = Type.Object({ id, operationId: id }, { additionalProperties: false });
const integer = Type.String({ pattern: '^(0|[1-9][0-9]{0,14})$' });
const paging = {
  cursor: Type.Optional(integer),
  limit: Type.Optional(Type.String({ pattern: '^([1-9]|[1-4][0-9]|50)$' })),
};
const pageSchema = Type.Object(paging, { additionalProperties: false });
const changes = Type.Object(
  { ...FileChangesQuerySchema.properties, ...paging },
  { additionalProperties: false },
);
const detail = Type.Object(
  {
    ...FileChangeDetailQuerySchema.properties,
    offset: Type.Optional(integer),
    maxBytes: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{3,4}$' })),
  },
  { additionalProperties: false },
);
const empty = Type.Object({}, { additionalProperties: false });

function page(input: PageQuery): { cursor?: number; limit?: number } {
  return {
    ...(input.cursor === undefined ? {} : { cursor: Number(input.cursor) }),
    ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
  };
}

/** Authenticated history reads and durable user operations never accept filesystem paths or byte payloads. */
export function registerFileChangeRoutes(
  server: FastifyInstance,
  store: ProfileStore,
  batches: FileChangeBatches,
): void {
  const root = '/api/sessions/:id/file-changes';
  server.get<{ Params: SessionParams; Querystring: ChangesQuery }>(
    root,
    {
      schema: { params, querystring: changes, response: { 200: FileChangesPageSchema } },
    },
    (request) => {
      const { cursor, limit, ...filters } = request.query;
      return store.listFileChanges(request.params.id, {
        ...filters,
        ...page({
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        }),
      });
    },
  );
  server.get<{ Params: SessionParams; Querystring: PageQuery }>(
    `${root}/operations`,
    {
      schema: { params, querystring: pageSchema, response: { 200: FileChangeBatchPageSchema } },
    },
    (request) => store.listFileChangeBatches(request.params.id, page(request.query)),
  );
  server.post<{ Params: SessionParams; Body: FileChangeBatchInput }>(
    `${root}/operations`,
    {
      schema: {
        params,
        body: FileChangeBatchInputSchema,
        response: { 200: FileChangeBatchReceiptSchema, 202: FileChangeBatchReceiptSchema },
      },
    },
    (request, reply) => {
      const receipt = batches.accept(request.params.id, request.body);
      return reply
        .code(receipt.status === 'accepted' || receipt.status === 'running' ? 202 : 200)
        .send(receipt);
    },
  );
  server.get<{ Params: OperationParams }>(
    `${root}/operations/:operationId`,
    {
      schema: { params: operationParams, response: { 200: FileChangeBatchReceiptSchema } },
    },
    (request) => store.getFileChangeBatch(request.params.id, request.params.operationId),
  );
  server.post<{ Params: OperationParams; Body: Record<string, never> }>(
    `${root}/operations/:operationId/cancel`,
    {
      schema: {
        params: operationParams,
        body: empty,
        response: { 200: FileChangeBatchReceiptSchema },
      },
    },
    (request) => batches.cancel(request.params.id, request.params.operationId),
  );
  server.get<{ Params: ChangeParams; Querystring: DetailQuery }>(
    `${root}/:changeId`,
    {
      schema: {
        params: changeParams,
        querystring: detail,
        response: { 200: FileChangeDetailSchema },
      },
    },
    (request) => {
      const { offset, maxBytes, ...filters } = request.query;
      return store.getFileChange(request.params.id, request.params.changeId, {
        ...filters,
        ...(offset === undefined ? {} : { offset: Number(offset) }),
        ...(maxBytes === undefined ? {} : { maxBytes: Number(maxBytes) }),
      });
    },
  );
}
