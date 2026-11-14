import { Type, type Static } from 'typebox';

export type FileChangeImage = Static<typeof FileChangeImageSchema>;
export type FileChangeSummary = Static<typeof FileChangeSummarySchema>;
export type FileChangesQuery = Static<typeof FileChangesQuerySchema>;
export type FileChangesPage = Static<typeof FileChangesPageSchema>;
export type FileChangeDetailQuery = Static<typeof FileChangeDetailQuerySchema>;
export type FileChangeDetail = Static<typeof FileChangeDetailSchema>;
export type FileChangeBatchInput = Static<typeof FileChangeBatchInputSchema>;
export type FileChangeBatchReceipt = Static<typeof FileChangeBatchReceiptSchema>;
export type FileChangeBatchItem = Static<typeof FileChangeBatchItemSchema>;
export type FileChangeBatchSummary = Static<typeof FileChangeBatchSummarySchema>;
export type FileChangeBatchQuery = Static<typeof FileChangeBatchQuerySchema>;
export type FileChangeBatchPage = Static<typeof FileChangeBatchPageSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableCount = Type.Union([count, Type.Null()]);
const path = Type.String({ minLength: 1, maxLength: 2000 });
const digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
const error = Type.Union([Type.String({ maxLength: 500 }), Type.Null()]);
const action = Type.Union([Type.Literal('undo'), Type.Literal('redo')]);
const batchStatus = Type.Union([
  Type.Literal('accepted'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('partial'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
]);

/** Exact text-file metadata; absent files are distinct from present zero-byte files. */
export const FileChangeImageSchema = Type.Union([
  Type.Object({ exists: Type.Literal(false) }, { additionalProperties: false }),
  Type.Object(
    {
      exists: Type.Literal(true),
      sha256: digest,
      bytes: Type.Integer({ minimum: 0, maximum: 500_000 }),
      mode: Type.Integer({ minimum: 0, maximum: 0o777 }),
    },
    { additionalProperties: false },
  ),
]);
export const FileOperationStatusSchema = Type.Union([
  Type.Literal('prepared'),
  Type.Literal('applied'),
  Type.Literal('not_applied'),
  Type.Literal('conflict'),
  Type.Literal('unknown'),
]);
export const FileChangeSummarySchema = Type.Object(
  {
    changeId: id,
    sessionId: id,
    seq: count,
    workspaceId: id,
    path,
    branchId: id,
    runId: nullableId,
    taskId: nullableId,
    toolCallId: nullableId,
    answerInputMessageId: nullableId,
    before: FileChangeImageSchema,
    after: FileChangeImageSchema,
    createdAt: count,
    updatedAt: count,
    status: FileOperationStatusSchema,
    state: Type.Union([
      Type.Literal('applied'),
      Type.Literal('undone'),
      Type.Literal('unavailable'),
    ]),
    revision: count,
    local: Type.Boolean({
      description: 'Recorded by this host; imported history remains read-only.',
    }),
    undoAvailable: Type.Boolean(),
    redoAvailable: Type.Boolean(),
    blockedReason: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const FileChangesQuerySchema = Type.Object(
  {
    cursor: Type.Optional(count),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    toolCallId: Type.Optional(id),
    inputMessageId: Type.Optional(id),
  },
  { additionalProperties: false },
);
export const FileChangesPageSchema = Type.Object(
  {
    items: Type.Array(FileChangeSummarySchema, { maxItems: 50 }),
    nextCursor: nullableCount,
    canOperate: Type.Boolean({
      description: 'The complete query scope contains local applied history.',
    }),
  },
  { additionalProperties: false },
);
export const FileChangeDetailQuerySchema = Type.Object(
  {
    side: Type.Optional(
      Type.Union([Type.Literal('diff'), Type.Literal('before'), Type.Literal('after')]),
    ),
    offset: Type.Optional(count),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 60 * 1024 })),
  },
  { additionalProperties: false },
);
export const FileChangeDetailSchema = Type.Object(
  {
    change: FileChangeSummarySchema,
    side: Type.Union([Type.Literal('diff'), Type.Literal('before'), Type.Literal('after')]),
    text: Type.String({ maxLength: 65536 }),
    offset: count,
    nextOffset: nullableCount,
  },
  { additionalProperties: false },
);
/** The host freezes the complete selected set; an answer selection never means only mounted rows. */
export const FileChangeBatchInputSchema = Type.Object(
  {
    operationId: id,
    action,
    selection: Type.Union([
      Type.Object(
        {
          kind: Type.Literal('changes'),
          changeIds: Type.Array(id, { minItems: 1, maxItems: 50, uniqueItems: true }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal('answer'), inputMessageId: id },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
export const FileChangeBatchItemSchema = Type.Object(
  {
    changeId: id,
    path,
    fileOperationId: nullableId,
    status: Type.Union([
      Type.Literal('not_started'),
      Type.Literal('running'),
      Type.Literal('applied'),
      Type.Literal('not_applied'),
      Type.Literal('conflict'),
      Type.Literal('unknown'),
      Type.Literal('cancelled'),
    ]),
    error,
  },
  { additionalProperties: false },
);
export const FileChangeBatchReceiptSchema = Type.Object(
  {
    operationId: id,
    action,
    status: batchStatus,
    cancelRequested: Type.Boolean(),
    createdAt: count,
    updatedAt: count,
    finishedAt: nullableCount,
    items: Type.Array(FileChangeBatchItemSchema, { minItems: 1, maxItems: 50 }),
    error,
  },
  { additionalProperties: false },
);
export const FileChangeBatchSummarySchema = Type.Object(
  {
    operationId: id,
    action,
    status: batchStatus,
    cancelRequested: Type.Boolean(),
    createdAt: count,
    updatedAt: count,
    finishedAt: nullableCount,
    itemCount: count,
    appliedCount: count,
    failedCount: count,
    unknownCount: count,
    error,
  },
  { additionalProperties: false },
);
export const FileChangeBatchQuerySchema = Type.Object(
  { cursor: Type.Optional(count), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) },
  { additionalProperties: false },
);
export const FileChangeBatchPageSchema = Type.Object(
  { items: Type.Array(FileChangeBatchSummarySchema, { maxItems: 50 }), nextCursor: nullableCount },
  { additionalProperties: false },
);
