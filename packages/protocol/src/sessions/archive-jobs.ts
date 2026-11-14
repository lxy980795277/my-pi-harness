import { Type, type Static } from 'typebox';
import { SessionArchivePreviewSchema } from './archives';

export type SessionArchiveJob = Static<typeof SessionArchiveJobSchema>;
export type SessionArchiveJobsPage = Static<typeof SessionArchiveJobsPageSchema>;
export type SessionArchiveJobsQuery = Static<typeof SessionArchiveJobsQuerySchema>;

/** Compressed transfer limit; expanded entries have additional host-enforced limits. */
export const SESSION_ARCHIVE_MAXIMUM_UPLOAD_BYTES = 256 * 1024 * 1024;
const id = Type.String({ minLength: 1, maxLength: 160 });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableId = Type.Union([id, Type.Null()]);
const nullableHash = Type.Union([Type.String({ pattern: '^[a-f0-9]{64}$' }), Type.Null()]);

/** Host-owned transfer progress; completed imports are reconstructed from durable receipts after restart. */
export const SessionArchiveJobSchema = Type.Object(
  {
    operationId: id,
    kind: Type.Union([Type.Literal('export'), Type.Literal('import')]),
    status: Type.Union([
      Type.Literal('running'),
      Type.Literal('ready'),
      Type.Literal('publishing'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
      Type.Literal('failed'),
    ]),
    phase: Type.Union([
      Type.Literal('collecting'),
      Type.Literal('packing'),
      Type.Literal('uploading'),
      Type.Literal('validating'),
      Type.Literal('ready'),
      Type.Literal('publishing'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
      Type.Literal('failed'),
    ]),
    bytesProcessed: count,
    downloadAvailable: Type.Boolean(),
    totalBytes: Type.Union([count, Type.Null()]),
    archiveSha256: nullableHash,
    sessionId: nullableId,
    preview: Type.Union([SessionArchivePreviewSchema, Type.Null()]),
    error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    createdAt: count,
    updatedAt: count,
  },
  { additionalProperties: false },
);
export const SessionArchiveJobsQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export const SessionArchiveJobsPageSchema = Type.Object(
  {
    items: Type.Array(SessionArchiveJobSchema, { maxItems: 50 }),
    nextCursor: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
