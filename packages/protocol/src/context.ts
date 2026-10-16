import { Type, type Static } from 'typebox';

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const timestamp = Type.Integer({ minimum: 0 });

/** Public attachment metadata; original bytes and extracted content stay on the host. */
export const AttachmentSchema = Type.Object(
  {
    id,
    name: Type.String({ minLength: 1, maxLength: 240 }),
    mediaType: Type.String({ minLength: 1, maxLength: 100 }),
    kind: Type.Union([
      Type.Literal('text'),
      Type.Literal('image'),
      Type.Literal('pdf'),
      Type.Literal('document'),
      Type.Literal('reference'),
    ]),
    byteLength: Type.Integer({ minimum: 0, maximum: 8_388_608 }),
    preview: Type.String({ maxLength: 4000 }),
    sourcePath: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    workspaceId: Type.Optional(Type.Union([id, Type.Null()])),
    createdAt: timestamp,
  },
  { additionalProperties: false },
);
export type Attachment = Static<typeof AttachmentSchema>;
export const AttachmentContentSchema = Type.Object(
  {
    attachment: AttachmentSchema,
    text: Type.Union([Type.String({ maxLength: 256_000 }), Type.Null()]),
    imageData: Type.Union([Type.String({ maxLength: 2_796_208 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type AttachmentContent = Static<typeof AttachmentContentSchema>;
export const AttachmentUploadSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 240 }),
    mediaType: Type.String({ minLength: 1, maxLength: 100 }),
    data: Type.String({ maxLength: 11_184_812 }),
  },
  { additionalProperties: false },
);
export const AttachmentReferenceSchema = Type.Object(
  {
    workspaceId: id,
    path: Type.String({ minLength: 1, maxLength: 2000 }),
    startLine: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
    endLine: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);
export type AttachmentUpload = Static<typeof AttachmentUploadSchema>;
export type AttachmentReference = Static<typeof AttachmentReferenceSchema>;

/** The exact bounded rule text frozen for a run, in shallow-to-deep precedence order. */
export const RuleSourceSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 2000 }),
    hash: Type.String({ minLength: 64, maxLength: 64 }),
    content: Type.String({ maxLength: 65_536 }),
    byteLength: Type.Integer({ minimum: 0, maximum: 65_536 }),
  },
  { additionalProperties: false },
);
export type RuleSource = Static<typeof RuleSourceSchema>;
export const ContextUsageSchema = Type.Object(
  {
    estimatedTokens: Type.Integer({ minimum: 0 }),
    windowTokens: Type.Integer({ minimum: 1 }),
    reservedOutput: Type.Integer({ minimum: 0 }),
    inputBudget: Type.Integer({ minimum: 1 }),
    trimmedMessages: Type.Integer({ minimum: 0 }),
    prunedMessages: Type.Integer({ minimum: 0 }),
    source: Type.Union([Type.Literal('estimated'), Type.Literal('provider')]),
    providerInputTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    categories: Type.Object(
      {
        system: Type.Integer({ minimum: 0 }),
        rules: Type.Integer({ minimum: 0 }),
        tools: Type.Integer({ minimum: 0 }),
        messages: Type.Integer({ minimum: 0 }),
        attachments: Type.Integer({ minimum: 0 }),
        summary: Type.Integer({ minimum: 0 }),
        workingState: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ContextUsage = Static<typeof ContextUsageSchema>;

const summaryItems = Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), { maxItems: 50 });
/** Semantic facts retained when earlier model messages leave the active context. */
export const ContextSummarySchema = Type.Object(
  {
    objective: Type.String({ maxLength: 4000 }),
    constraints: summaryItems,
    decisions: summaryItems,
    completed: summaryItems,
    pending: summaryItems,
    blockers: summaryItems,
    nextAction: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);
export type ContextSummary = Static<typeof ContextSummarySchema>;
export const CompactionSchema = Type.Object(
  {
    id,
    throughMessageId: id,
    summary: Type.String({ minLength: 1, maxLength: 32_000 }),
    structured: ContextSummarySchema,
    parentId: nullableId,
    strategy: Type.Union([Type.Literal('model'), Type.Literal('fallback')]),
    beforeTokens: Type.Integer({ minimum: 0 }),
    afterTokens: Type.Integer({ minimum: 0 }),
    sourceMessages: Type.Integer({ minimum: 1 }),
    runId: nullableId,
    createdAt: timestamp,
    reason: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
  },
  { additionalProperties: false },
);
export type Compaction = Static<typeof CompactionSchema>;
const progress = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
]);
export const PlanStepSchema = Type.Object(
  { id, title: Type.String({ minLength: 1, maxLength: 1000 }), status: progress },
  { additionalProperties: false },
);
export type PlanStep = Static<typeof PlanStepSchema>;
export const TodoSchema = Type.Object(
  {
    id,
    title: Type.String({ minLength: 1, maxLength: 1000 }),
    status: Type.Union([progress, Type.Literal('blocked'), Type.Literal('cancelled')]),
    planStepId: nullableId,
    evidenceToolCallIds: Type.Array(id, { maxItems: 20 }),
    completionNote: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type Todo = Static<typeof TodoSchema>;
export const PlanSchema = Type.Object(
  {
    id,
    runId: nullableId,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    content: Type.String({ minLength: 1, maxLength: 32_000 }),
    steps: Type.Array(PlanStepSchema, { maxItems: 100 }),
    status: Type.Union([
      Type.Literal('draft'),
      Type.Literal('approved'),
      Type.Literal('completed'),
    ]),
    review: Type.Union([
      Type.Null(),
      Type.Literal('pending'),
      Type.Literal('approved'),
      Type.Literal('feedback'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
    ]),
    feedback: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    updatedAt: timestamp,
  },
  { additionalProperties: false },
);
export type Plan = Static<typeof PlanSchema>;
export const QuestionOptionSchema = Type.Object(
  {
    id,
    label: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type QuestionOption = Static<typeof QuestionOptionSchema>;
export const QuestionItemSchema = Type.Object(
  {
    id,
    header: Type.String({ minLength: 1, maxLength: 100 }),
    prompt: Type.String({ minLength: 1, maxLength: 4000 }),
    options: Type.Array(QuestionOptionSchema, { maxItems: 12 }),
    multiSelect: Type.Boolean(),
    allowCustomInput: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type QuestionItem = Static<typeof QuestionItemSchema>;
export const QuestionResponseSchema = Type.Object(
  {
    questionId: id,
    optionIds: Type.Array(id, { maxItems: 12 }),
    text: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);
export type QuestionResponse = Static<typeof QuestionResponseSchema>;
export const QuestionSchema = Type.Object(
  {
    id,
    runId: id,
    branchId: id,
    toolCallId: id,
    questions: Type.Array(QuestionItemSchema, { minItems: 1, maxItems: 12 }),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('answered'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
    ]),
    answers: Type.Union([
      Type.Array(QuestionResponseSchema, { minItems: 1, maxItems: 12 }),
      Type.Null(),
    ]),
    createdAt: timestamp,
  },
  { additionalProperties: false },
);
export type Question = Static<typeof QuestionSchema>;

/** Branch-local work state; changes append a complete, revision-checked event snapshot. */
export const WorkStateSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    branchId: id,
    mode: Type.Union([Type.Literal('execute'), Type.Literal('plan')]),
    rules: Type.Array(RuleSourceSchema, { maxItems: 16 }),
    usage: Type.Union([ContextUsageSchema, Type.Null()]),
    compaction: Type.Union([CompactionSchema, Type.Null()]),
    contextStartAfterMessageId: nullableId,
    plan: Type.Union([PlanSchema, Type.Null()]),
    todos: Type.Array(TodoSchema, { maxItems: 100 }),
    questions: Type.Array(QuestionSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type WorkState = Static<typeof WorkStateSchema>;
export const CheckpointSchema = Type.Object(
  {
    id,
    sessionId: id,
    branchId: id,
    label: Type.String({ minLength: 1, maxLength: 200 }),
    createdAt: timestamp,
    messageIds: Type.Array(id, { maxItems: 10_000 }),
    state: WorkStateSchema,
  },
  { additionalProperties: false },
);
export type Checkpoint = Static<typeof CheckpointSchema>;
export const WorkSnapshotSchema = Type.Object(
  {
    state: WorkStateSchema,
    checkpoints: Type.Array(CheckpointSchema, { maxItems: 100 }),
    compactions: Type.Array(CompactionSchema),
  },
  { additionalProperties: false },
);
export type WorkSnapshot = Static<typeof WorkSnapshotSchema>;
export const WorkPatchSchema = Type.Object(
  {
    expectedBranchId: id,
    revision: Type.Integer({ minimum: 0 }),
    mode: Type.Optional(Type.Union([Type.Literal('execute'), Type.Literal('plan')])),
    todos: Type.Optional(Type.Array(TodoSchema, { maxItems: 100 })),
  },
  { additionalProperties: false },
);
export type WorkPatch = Static<typeof WorkPatchSchema>;
export const QuestionAnswerSchema = Type.Object(
  { answers: Type.Array(QuestionResponseSchema, { minItems: 1, maxItems: 12 }) },
  { additionalProperties: false },
);
export type QuestionAnswer = Static<typeof QuestionAnswerSchema>;
export const PlanReviewSchema = Type.Object(
  {
    expectedBranchId: id,
    revision: Type.Integer({ minimum: 0 }),
    decision: Type.Union([
      Type.Literal('approve'),
      Type.Literal('feedback'),
      Type.Literal('cancel'),
    ]),
    feedback: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);
export type PlanReview = Static<typeof PlanReviewSchema>;
export const CheckpointCreateSchema = Type.Object(
  {
    expectedBranchId: id,
    label: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type CheckpointCreate = Static<typeof CheckpointCreateSchema>;
export const ContextResetSchema = Type.Object(
  {
    expectedBranchId: id,
    revision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ContextReset = Static<typeof ContextResetSchema>;

/** Empty work state for an existing branch; no persisted history is changed by this factory. */
export function initialWorkState(branchId: string): WorkState {
  return {
    revision: 0,
    branchId,
    mode: 'execute',
    rules: [],
    usage: null,
    compaction: null,
    contextStartAfterMessageId: null,
    plan: null,
    todos: [],
    questions: [],
  };
}
