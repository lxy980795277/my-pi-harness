import { Type, type TSchema } from 'typebox';
import {
  BranchViewSchema,
  CheckpointSchema,
  ContextUsageSchema,
  FrozenMcpToolSchema,
  FrozenSkillSchema,
  MessageViewSchema,
  QueueInputSchema,
  RunViewSchema,
  SessionPatchInputSchema,
  SessionSummarySchema,
  SkillSelectionsSchema,
  ToolCallRecordSchema,
  ToolDiscoveryDiagnosticSchema,
  WorkStateSchema,
} from '@my-pi-harness/protocol';

export const SessionCreatedSchema = Type.Object(
  { session: SessionSummarySchema, branch: BranchViewSchema },
  { additionalProperties: false },
);
export const RunAcceptedSchema = Type.Object(
  {
    run: RunViewSchema,
    requestId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export const RunFinishedSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('cancelled'),
      Type.Literal('failed'),
      Type.Literal('interrupted'),
    ]),
    finishedAt: Type.Integer({ minimum: 0 }),
    error: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export const MessageCompletedSchema = Type.Object(
  { message: MessageViewSchema },
  { additionalProperties: false },
);
export const MessageDeltaSchema = Type.Object(
  {
    messageId: Type.String({ minLength: 1 }),
    text: Type.Optional(Type.String()),
    thinking: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const InputIdSchema = Type.Object(
  { inputId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export const BranchSelectionSchema = Type.Object(
  { branchId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export const QueueRequestSchema = Type.Object(
  {
    version: Type.Literal(1),
    requestId: Type.String({ minLength: 1 }),
    mcpBindings: Type.Array(FrozenMcpToolSchema, { maxItems: 512 }),
    candidateBindings: Type.Array(FrozenMcpToolSchema, { maxItems: 512 }),
    skillBindings: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
    mentionedSkillBindings: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
    inheritedSkillBindings: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
    discoveryDiagnostics: Type.Array(ToolDiscoveryDiagnosticSchema, { maxItems: 512 }),
  },
  { additionalProperties: false },
);

export const WorkEventSchema = Type.Object(
  { state: WorkStateSchema },
  { additionalProperties: false },
);
export const CheckpointEventSchema = Type.Object(
  { checkpoint: CheckpointSchema },
  { additionalProperties: false },
);
export const RestoreEventSchema = Type.Object(
  {
    branch: BranchViewSchema,
    messageIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 10_000 }),
  },
  { additionalProperties: false },
);
export const PreparedEventSchema = Type.Object(
  {
    branchId: Type.String({ minLength: 1 }),
    usage: ContextUsageSchema,
    messageIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 10_000 }),
    attachmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 4096 })),
    capabilityRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export const PreparedPrivateSchema = Type.Object(
  {
    version: Type.Literal(1),
    systemPrompt: Type.String(),
    messages: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);
export const ToolEventSchema = Type.Object(
  { tool: ToolCallRecordSchema, afterMessageId: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
export const ToolContextEventSchema = Type.Object(
  {
    branchId: Type.String({ minLength: 1, maxLength: 160 }),
    afterMessageId: Type.String({ minLength: 1, maxLength: 160 }),
    toolCallId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);
export const CapabilityLoadSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 2 }),
    names: Type.Array(Type.String(), { maxItems: 128, uniqueItems: true }),
    skills: SkillSelectionsSchema,
  },
  { additionalProperties: false },
);

/** Public payload fields consumed by projections; unregistered audit events keep their data. */
export const EVENT_DATA_SCHEMAS: ReadonlyMap<string, TSchema> = new Map<string, TSchema>([
  ['session.created', SessionCreatedSchema],
  ['session.configured', SessionPatchInputSchema],
  ['run.accepted', RunAcceptedSchema],
  ['run.finished', RunFinishedSchema],
  ['run.tools_loaded', CapabilityLoadSchema],
  ['message.started', MessageViewSchema],
  ['message.delta', MessageDeltaSchema],
  ['message.completed', MessageCompletedSchema],
  ['queue.added', QueueInputSchema],
  ['queue.updated', QueueInputSchema],
  ['queue.consumed', InputIdSchema],
  ['queue.deleted', InputIdSchema],
  ['branch.created', BranchViewSchema],
  ['branch.selected', BranchSelectionSchema],
  ['branch.restored', RestoreEventSchema],
  ['work.updated', WorkEventSchema],
  ['checkpoint.created', CheckpointEventSchema],
  ['context.prepared', PreparedEventSchema],
  ['tool.requested', ToolEventSchema],
  ['tool.updated', ToolEventSchema],
  ['tool.context', ToolContextEventSchema],
]);
