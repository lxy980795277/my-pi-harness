import { type Static, Type } from 'typebox';
import { MemoryModeSchema } from '../memory/memory';

export type SearchScope = Static<typeof SearchScopeSchema>;
export type SearchSourceRef = Static<typeof SearchSourceRefSchema>;
export type SearchQueryInput = Static<typeof SearchQueryInputSchema>;
export type SearchHit = Static<typeof SearchHitSchema>;
export type SearchQueryResult = Static<typeof SearchQueryResultSchema>;
export type SearchModelStatus = Static<typeof SearchModelStatusSchema>;
export type SearchRerankerStatus = Static<typeof SearchRerankerStatusSchema>;
export type SearchIndexStatus = Static<typeof SearchIndexStatusSchema>;
export type SearchSourceTarget = Static<typeof SearchSourceTargetSchema>;
export type SearchSourceSelection = Static<typeof SearchSourceSelectionSchema>;
export type SearchSourceReadInput = Static<typeof SearchSourceReadInputSchema>;
export type SearchSourceExcerpt = Static<typeof SearchSourceExcerptSchema>;
export type SearchWindowCursor = Static<typeof SearchWindowCursorSchema>;
export type SearchSourceWindow = Static<typeof SearchSourceWindowSchema>;

const id = Type.String({ minLength: 1, maxLength: 200 });
const nullableId = Type.Union([id, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const sourceKind = Type.Union([Type.Literal('memory'), Type.Literal('message')]);
const sourceOrigin = Type.Union([
  Type.Literal('memory'),
  Type.Literal('user'),
  Type.Literal('assistant'),
  Type.Literal('task'),
  Type.Literal('communication'),
]);

/** Human filters; model consumers must construct a narrower host-owned scope themselves. */
export const SearchScopeSchema = Type.Object(
  {
    workspaceId: Type.Optional(nullableId),
    allWorkspaces: Type.Optional(Type.Boolean()),
    sessionId: Type.Optional(id),
    branchId: Type.Optional(id),
    taskId: Type.Optional(id),
    includeArchived: Type.Optional(Type.Boolean()),
    includeHistoricalBranches: Type.Optional(Type.Boolean()),
    includeTasks: Type.Optional(Type.Boolean()),
    includeUserMemories: Type.Optional(Type.Boolean()),
    kind: Type.Optional(sourceKind),
    memoryMode: Type.Optional(MemoryModeSchema),
    createdFrom: Type.Optional(count),
    createdTo: Type.Optional(count),
  },
  { additionalProperties: false },
);

/** Stable source identity plus exact UTF-8 body hash, independent of branch membership. */
export const SearchSourceRefSchema = Type.Object(
  {
    id,
    kind: sourceKind,
    contentHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  },
  { additionalProperties: false },
);

/** A target selects one exact membership without changing the session's active branch. */
export const SearchSourceTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('message'),
      sessionId: id,
      branchId: id,
      messageId: id,
      taskId: Type.Optional(id),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('memory'), memoryId: id }, { additionalProperties: false }),
]);

/** A quote grants only this exact UTF-16 half-open range; the hash remains in source. */
export const SearchSourceSelectionSchema = Type.Object(
  { source: SearchSourceRefSchema, target: SearchSourceTargetSchema, start: count, end: count },
  { additionalProperties: false },
);
export const SearchWindowCursorSchema = Type.Object(
  { direction: Type.Union([Type.Literal('before'), Type.Literal('after')]), messageId: id },
  { additionalProperties: false },
);
export const SearchSourceReadInputSchema = Type.Object(
  {
    selection: SearchSourceSelectionSchema,
    before: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
    after: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
    cursor: Type.Optional(SearchWindowCursorSchema),
    textOffset: Type.Optional(count),
  },
  {
    additionalProperties: false,
    not: Type.Object({ cursor: SearchWindowCursorSchema, textOffset: count }),
  },
);
export const SearchSourceExcerptSchema = Type.Object(
  {
    source: SearchSourceRefSchema,
    target: SearchSourceTargetSchema,
    start: count,
    end: count,
    text: Type.String({ maxLength: 8000 }),
    totalLength: count,
    origin: sourceOrigin,
    role: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('assistant')])),
    status: Type.String({ maxLength: 32 }),
    createdAt: count,
  },
  { additionalProperties: false },
);
/** Only bounded persistent excerpts cross to the reader; tools, thinking and live deltas are absent. */
export const SearchSourceWindowSchema = Type.Object(
  {
    selection: SearchSourceSelectionSchema,
    title: Type.String({ maxLength: 500 }),
    workspaceId: nullableId,
    archived: Type.Boolean(),
    historicalBranch: Type.Boolean(),
    items: Type.Array(SearchSourceExcerptSchema, { maxItems: 9 }),
    previous: Type.Union([SearchWindowCursorSchema, Type.Null()]),
    next: Type.Union([SearchWindowCursorSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const SearchQueryInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    scope: Type.Optional(SearchScopeSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

/** Plain source excerpts have UTF-16 half-open offsets; no FTS-produced HTML reaches clients. */
export const SearchHitSchema = Type.Object(
  {
    source: SearchSourceRefSchema,
    title: Type.String({ maxLength: 500 }),
    workspaceId: nullableId,
    sessionId: Type.Optional(id),
    branchId: Type.Optional(id),
    taskId: Type.Optional(id),
    messageId: Type.Optional(id),
    memoryId: Type.Optional(id),
    origin: sourceOrigin,
    status: Type.String({ maxLength: 32 }),
    start: count,
    end: count,
    text: Type.String({ maxLength: 16_000 }),
    score: Type.Number(),
    createdAt: count,
  },
  { additionalProperties: false },
);

export const SearchQueryResultSchema = Type.Object(
  {
    hits: Type.Array(SearchHitSchema, { maxItems: 50 }),
    mode: Type.Union([Type.Literal('lexical'), Type.Literal('hybrid')]),
    truncated: Type.Boolean(),
    generation: Type.Integer({ minimum: 1 }),
    watermark: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  },
  { additionalProperties: false },
);

const modelResourceFields = {
  state: Type.Union([
    Type.Literal('unprepared'),
    Type.Literal('preparing'),
    Type.Literal('ready'),
    Type.Literal('unavailable'),
  ]),
  modelId: Type.String(),
  revision: Type.String(),
  signature: Type.String(),
  maxInputTokens: Type.Integer({ minimum: 1 }),
  progress: Type.Union([
    Type.Object(
      { loadedBytes: count, totalBytes: Type.Union([count, Type.Null()]) },
      { additionalProperties: false },
    ),
    Type.Null(),
  ]),
  error: Type.Union([
    Type.Literal('PREPARE_FAILED'),
    Type.Literal('LOCAL_MODEL_UNAVAILABLE'),
    Type.Null(),
  ]),
};

/** Resource readiness is separate from whether persistent search has caught up with facts. */
export const SearchModelStatusSchema = Type.Object(
  { ...modelResourceFields, dimensions: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

/** Local pairwise verification has independent readiness and does not produce embedding vectors. */
export const SearchRerankerStatusSchema = Type.Object(modelResourceFields, {
  additionalProperties: false,
});

export const SearchIndexStatusSchema = Type.Object(
  {
    state: Type.Union([Type.Literal('catching-up'), Type.Literal('ready'), Type.Literal('failed')]),
    generation: Type.Integer({ minimum: 1 }),
    buildingGeneration: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    lexicalReady: Type.Boolean(),
    sourceCount: count,
    chunkCount: count,
    vectorCount: count,
    pendingSources: count,
    error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/** Compare source revision and exact membership, independently of offsets; this grants no read permission. */
export function sameSearchSource(
  left: Pick<SearchSourceSelection, 'source' | 'target'>,
  right: Pick<SearchSourceSelection, 'source' | 'target'>,
): boolean {
  if (
    left.source.id !== right.source.id ||
    left.source.kind !== right.source.kind ||
    left.source.contentHash !== right.source.contentHash
  )
    return false;
  const leftTarget = left.target;
  const rightTarget = right.target;
  if (leftTarget.kind === 'memory')
    return rightTarget.kind === 'memory' && leftTarget.memoryId === rightTarget.memoryId;
  return (
    rightTarget.kind === 'message' &&
    leftTarget.sessionId === rightTarget.sessionId &&
    leftTarget.branchId === rightTarget.branchId &&
    leftTarget.messageId === rightTarget.messageId &&
    leftTarget.taskId === rightTarget.taskId
  );
}
