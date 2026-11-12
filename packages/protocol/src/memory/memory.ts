import { type Static, Type } from 'typebox';

export type MemoryScope = Static<typeof MemoryScopeSchema>;
export type MemoryMode = Static<typeof MemoryModeSchema>;
export type MemoryCategory = Static<typeof MemoryCategorySchema>;
export type MemorySource = Static<typeof MemorySourceSchema>;
export type MemoryMessageSource = Static<typeof MemoryMessageSourceSchema>;
export type MemoryEntry = Static<typeof MemoryEntrySchema>;
export type MemorySettings = Static<typeof MemorySettingsSchema>;
export type MemoryCreateInput = Static<typeof MemoryCreateInputSchema>;
export type MemoryUpdateInput = Static<typeof MemoryUpdateInputSchema>;
export type MemoryForgetInput = Static<typeof MemoryForgetInputSchema>;
export type MemorySettingsInput = Static<typeof MemorySettingsInputSchema>;
export type MemoryWriteReceipt = Static<typeof MemoryWriteReceiptSchema>;
export type MemoryMutationResult = Static<typeof MemoryMutationResultSchema>;
export type MemoryAdoptedEntry = Static<typeof MemoryAdoptedEntrySchema>;
export type MemoryUsage = Static<typeof MemoryUsageSchema>;
export type MemoryPage = Static<typeof MemoryPageSchema>;
export type MemoryListInput = Static<typeof MemoryListInputSchema>;
export type MemorySelection = Static<typeof MemorySelectionSchema>;
export type MemoryOmission = Static<typeof MemoryOmissionSchema>;
export type MemorySearchResult = Static<typeof MemorySearchResultSchema>;
export type MemoryStatusInput = Static<typeof MemoryStatusInputSchema>;
export type MemoryCurrentStatus = Static<typeof MemoryCurrentStatusSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const timestamp = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const body = Type.String({ minLength: 1, maxLength: 16_000 });
const contentHash = Type.String({ pattern: '^[0-9a-f]{64}$' });
const requestId = Type.String({ minLength: 1, maxLength: 160 });

/** A user scope or one registered workspace; the authenticated owner is never client input. */
export const MemoryScopeSchema = Type.Union([
  Type.Object({ kind: Type.Literal('user') }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('workspace'), workspaceId: id },
    { additionalProperties: false },
  ),
]);

export const MemoryCategorySchema = Type.Union([
  Type.Literal('preference'),
  Type.Literal('fact'),
  Type.Literal('instruction'),
]);

export const MemoryModeSchema = Type.Union([Type.Literal('fixed'), Type.Literal('relevant')]);

/** A message reference binds the exact saved root-message text without copying it. */
export const MemoryMessageSourceSchema = Type.Object(
  { kind: Type.Literal('message'), sessionId: id, branchId: id, messageId: id, contentHash },
  { additionalProperties: false },
);

export const MemorySourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('manual') }, { additionalProperties: false }),
  MemoryMessageSourceSchema,
]);

const memoryFields = {
  id,
  scope: MemoryScopeSchema,
  category: MemoryCategorySchema,
  body,
  revision,
  source: MemorySourceSchema,
};

/** An independent memory; enabled fixed entries are adopted on eligible requests. */
export const MemoryEntrySchema = Type.Object(
  {
    ...memoryFields,
    mode: MemoryModeSchema,
    enabled: Type.Boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { additionalProperties: false },
);

/** Revision zero denotes domain defaults that have not been persisted yet. */
export const MemorySettingsSchema = Type.Object(
  {
    allowUse: Type.Boolean(),
    allowLearning: Type.Boolean(),
    revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

export const MemoryCreateInputSchema = Type.Object(
  {
    requestId,
    scope: MemoryScopeSchema,
    category: MemoryCategorySchema,
    body,
    enabled: Type.Boolean(),
    mode: Type.Optional(MemoryModeSchema),
    source: Type.Optional(MemorySourceSchema),
  },
  { additionalProperties: false },
);

/** Editing a confirmed fact does not depend on its historical source remaining available. */
export const MemoryUpdateInputSchema = Type.Object(
  {
    requestId,
    expectedRevision: revision,
    category: MemoryCategorySchema,
    body,
    enabled: Type.Boolean(),
    mode: Type.Optional(MemoryModeSchema),
  },
  { additionalProperties: false },
);

export const MemoryForgetInputSchema = Type.Object(
  { requestId, expectedRevision: revision },
  { additionalProperties: false },
);

export const MemorySettingsInputSchema = Type.Object(
  {
    requestId,
    expectedRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    allowUse: Type.Boolean(),
    allowLearning: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Receipts retain operation identity after forgetting without retaining another body. */
export const MemoryWriteReceiptSchema = Type.Object(
  {
    requestId,
    operation: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('forget')]),
    memoryId: id,
    revision,
    status: Type.Union([Type.Literal('applied'), Type.Literal('forgotten')]),
  },
  { additionalProperties: false },
);

/** A repeated old write can have a receipt but no surviving entry after explicit forgetting. */
export const MemoryMutationResultSchema = Type.Object(
  { entry: Type.Union([MemoryEntrySchema, Type.Null()]), receipt: MemoryWriteReceiptSchema },
  { additionalProperties: false },
);

/** Exact bounded memory text adopted by a historical Provider request. */
export const MemoryAdoptedEntrySchema = Type.Object(
  { ...memoryFields, mode: Type.Optional(MemoryModeSchema) },
  { additionalProperties: false },
);

export const MemoryOmissionSchema = Type.Object(
  {
    id,
    revision,
    mode: MemoryModeSchema,
    reason: Type.Union([
      Type.Literal('disabled'),
      Type.Literal('usage-disabled'),
      Type.Literal('below-threshold'),
      Type.Literal('not-retrieved'),
      Type.Literal('no-query'),
      Type.Literal('limit'),
      Type.Literal('budget'),
      Type.Literal('stale'),
      Type.Literal('unverified'),
    ]),
    score: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/** Bounded explanation metadata has no duplicate body and does not grant access to omitted facts. */
export const MemorySelectionSchema = Type.Object(
  {
    retrieval: Type.Union([
      Type.Literal('fixed'),
      Type.Literal('lexical'),
      Type.Literal('hybrid'),
      Type.Literal('disabled'),
    ]),
    candidateCount: Type.Integer({ minimum: 0 }),
    matchedCount: Type.Integer({ minimum: 0 }),
    omittedCount: Type.Integer({ minimum: 0 }),
    omissions: Type.Array(MemoryOmissionSchema, { maxItems: 32 }),
    verification: Type.Optional(
      Type.Union([
        Type.Literal('local-model'),
        Type.Literal('unavailable'),
        Type.Literal('not-needed'),
      ]),
    ),
    truncated: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const MemoryListInputSchema = Type.Object(
  {
    scope: Type.Optional(MemoryScopeSchema),
    mode: Type.Optional(MemoryModeSchema),
    cursor: Type.Optional(id),
    enabled: Type.Optional(Type.Boolean()),
    category: Type.Optional(MemoryCategorySchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const MemoryPageSchema = Type.Object(
  {
    items: Type.Array(MemoryEntrySchema, { maxItems: 100 }),
    nextCursor: Type.Union([id, Type.Null()]),
    total: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MemoryStatusInputSchema = Type.Object(
  { ids: Type.Array(id, { maxItems: 128, uniqueItems: true }) },
  { additionalProperties: false },
);
export const MemoryCurrentStatusSchema = Type.Object(
  {
    id,
    revision: Type.Union([revision, Type.Null()]),
    enabled: Type.Boolean(),
    mode: Type.Union([MemoryModeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const MemorySearchResultSchema = Type.Object(
  {
    entries: Type.Array(MemoryAdoptedEntrySchema, { maxItems: 20 }),
    mode: Type.Union([Type.Literal('lexical'), Type.Literal('hybrid')]),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const MemoryUsageSchema = Type.Object(
  {
    sessionId: id,
    runId: id,
    taskId: Type.Optional(id),
    preparedSeq: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    preparedAt: timestamp,
    entries: Type.Array(MemoryAdoptedEntrySchema, { maxItems: 108 }),
    selection: Type.Optional(MemorySelectionSchema),
  },
  { additionalProperties: false },
);
