import { Type, type Static } from 'typebox';
import { MessageUsageSchema } from './sessions';

export type ModelRequestPurpose = Static<typeof ModelRequestPurposeSchema>;
export type ModelRequestStatus = Static<typeof ModelRequestStatusSchema>;
export type ModelRequestSummary = Static<typeof ModelRequestSummarySchema>;
export type ModelRequestCostEstimate = Static<typeof ModelRequestCostEstimateSchema>;
export type TraceEntry = Static<typeof TraceEntrySchema>;
export type TraceQuery = Static<typeof TraceQuerySchema>;
export type TracePage = Static<typeof TracePageSchema>;
export type ModelRequestDetailQuery = Static<typeof ModelRequestDetailQuerySchema>;
export type RequestContentItem = Static<typeof RequestContentItemSchema>;
export type ModelRequestDetail = Static<typeof ModelRequestDetailSchema>;
export type TraceEntryDetail = Static<typeof TraceEntryDetailSchema>;
export type UsageQuery = Static<typeof UsageQuerySchema>;
export type SessionUsage = Static<typeof SessionUsageSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableCount = Type.Union([count, Type.Null()]);
const kind = Type.Union([
  Type.Literal('request'),
  Type.Literal('tool'),
  Type.Literal('approval'),
  Type.Literal('compaction'),
]);
const section = Type.Union([
  Type.Literal('system'),
  Type.Literal('messages'),
  Type.Literal('tools'),
]);

/** Host-observed model invocation purpose, independently of the selected agent role. */
export const ModelRequestPurposeSchema = Type.Union([
  Type.Literal('conversation'),
  Type.Literal('approval'),
  Type.Literal('compaction'),
]);
/** A handed-off invocation remains running until its actual terminal result or recovery. */
export const ModelRequestStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
]);

/** Catalogue-derived USD estimate; these amounts are not a provider billing statement. */
export const ModelRequestCostEstimateSchema = Type.Object(
  {
    source: Type.Literal('pi-catalog'),
    catalogVersion: Type.String({ minLength: 1, maxLength: 100 }),
    currency: Type.Literal('USD'),
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    total: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
/** Compact request facts; preparedSeq points to host-only final input audit data. */
export const ModelRequestSummarySchema = Type.Object(
  {
    modelRequestId: id,
    sessionId: id,
    seq: count,
    branchId: id,
    runId: nullableId,
    taskId: nullableId,
    purpose: ModelRequestPurposeSchema,
    inputMessageId: nullableId,
    answerInputMessageId: nullableId,
    providerId: id,
    modelId: id,
    preparedSeq: nullableCount,
    queuedAt: count,
    queueDurationMs: nullableCount,
    startedAt: count,
    finishedAt: nullableCount,
    durationMs: nullableCount,
    firstResponseMs: nullableCount,
    status: ModelRequestStatusSchema,
    usage: Type.Union([MessageUsageSchema, Type.Null()]),
    error: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    responseId: nullableId,
    pricingSource: Type.Union([Type.Literal('pi-catalog'), Type.Literal('unknown')]),
    pricingCatalogVersion: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    costEstimate: Type.Union([ModelRequestCostEstimateSchema, Type.Null()]),
    cacheWrite1h: nullableCount,
  },
  { additionalProperties: false },
);
/** A summary timeline row; large tool and request bodies are fetched separately. */
export const TraceEntrySchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    seq: count,
    kind,
    at: count,
    runId: nullableId,
    taskId: nullableId,
    branchId: id,
    status: Type.String({ minLength: 1, maxLength: 40 }),
    title: Type.String({ maxLength: 500 }),
    modelRequestId: nullableId,
    toolCallId: nullableId,
    durationMs: nullableCount,
    error: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
/** Ascending sequence pagination freezes the committed upper watermark for each page chain. */
export const TraceQuerySchema = Type.Object(
  {
    cursor: Type.Optional(count),
    watermark: Type.Optional(count),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    branchId: Type.Optional(id),
    runId: Type.Optional(id),
    taskId: Type.Optional(id),
    includeDescendants: Type.Optional(Type.Boolean()),
    kind: Type.Optional(kind),
    purpose: Type.Optional(ModelRequestPurposeSchema),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  },
  { additionalProperties: false },
);
export const TracePageSchema = Type.Object(
  {
    items: Type.Array(TraceEntrySchema, { maxItems: 200 }),
    nextCursor: nullableCount,
    watermark: count,
  },
  { additionalProperties: false },
);
/** Cursor selects a content item; offset resumes its UTF-16 text without losing a truncated suffix. */
export const ModelRequestDetailQuerySchema = Type.Object(
  {
    section: Type.Optional(section),
    cursor: Type.Optional(count),
    offset: Type.Optional(count),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export const RequestContentItemSchema = Type.Object(
  {
    index: count,
    offset: count,
    role: Type.String({ maxLength: 100 }),
    text: Type.String({ maxLength: 65536 }),
    images: count,
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const ModelRequestDetailSchema = Type.Object(
  {
    summary: ModelRequestSummarySchema,
    section,
    items: Type.Array(RequestContentItemSchema, { maxItems: 50 }),
    nextCursor: nullableCount,
    nextOffset: nullableCount,
  },
  { additionalProperties: false },
);
export const TraceEntryDetailSchema = Type.Object(
  {
    entry: TraceEntrySchema,
    items: Type.Array(RequestContentItemSchema, { maxItems: 50 }),
    nextCursor: nullableCount,
    nextOffset: nullableCount,
  },
  { additionalProperties: false },
);
export const UsageQuerySchema = Type.Object(
  {
    branchId: Type.Optional(id),
    runId: Type.Optional(id),
    taskId: Type.Optional(id),
    inputMessageId: Type.Optional(id),
    includeDescendants: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
/** Request-set aggregation preserves unknown usage rather than replacing it with zero. */
export const SessionUsageSchema = Type.Object(
  {
    requestCount: count,
    recordedRequests: count,
    unknownRequests: count,
    tokens: MessageUsageSchema,
    modelDurationMs: count,
    timedRequests: count,
    unknownDurationRequests: count,
    queueDurationMs: count,
    timedQueueRequests: count,
    unknownQueueRequests: count,
    toolCalls: count,
    timedToolCalls: count,
    unknownToolDurationCalls: count,
    toolDurationMs: count,
    humanWaitMs: count,
    unknownHumanWaits: count,
    wallDurationMs: nullableCount,
    wallTimeBasis: Type.Union([
      Type.Literal('execution-union'),
      Type.Literal('answer-span'),
      Type.Literal('request-span'),
      Type.Literal('observed-union'),
      Type.Literal('unknown'),
    ]),
    estimatedCostUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    pricedRequests: count,
    unknownPriceRequests: count,
    estimatedRequests: count,
    unknownEstimateRequests: count,
    costComplete: Type.Boolean(),
    costScope: Type.Literal('model-requests'),
    externalServices: Type.Array(
      Type.Object(
        {
          service: Type.String({ minLength: 1, maxLength: 240 }),
          invocations: count,
          estimatedCostUsd: Type.Null(),
          costStatus: Type.Literal('unavailable'),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    externalServicesOmitted: count,
    omittedExternalInvocations: count,
    byPurpose: Type.Array(
      Type.Object(
        {
          purpose: ModelRequestPurposeSchema,
          requestCount: count,
          recordedRequests: count,
          tokens: MessageUsageSchema,
          modelDurationMs: count,
          timedRequests: count,
          unknownDurationRequests: count,
          estimatedCostUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
          estimatedRequests: count,
        },
        { additionalProperties: false },
      ),
      { maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);
