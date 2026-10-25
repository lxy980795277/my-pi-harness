import { McpToolSelectionsSchema } from './mcp.js';
import { SkillSelectionsSchema } from './skills.js';
import { type Static, Type } from 'typebox';
import { ThinkingLevelSchema } from './models.js';
import { ApprovalModeSchema, ToolCallViewSchema } from './tools.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const timestamp = Type.Integer({ minimum: 0 });
const text = Type.String({ maxLength: 64_000 });

/** Stable session navigation fields, including its committed projection cursor. */
export const SessionSummarySchema = Type.Object(
  {
    id,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    providerId: id,
    modelId: id,
    thinkingLevel: ThinkingLevelSchema,
    workspaceId: nullableId,
    approvalMode: ApprovalModeSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
    activeBranchId: id,
    activeRunId: nullableId,
    snapshotSeq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type SessionSummary = Static<typeof SessionSummarySchema>;

/** Provider-reported tokens for one assistant step; totals retain the provider's accounting. */
export const MessageUsageSchema = Type.Object(
  {
    inputTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    outputTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    cacheReadTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    cacheWriteTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    totalTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);
export type MessageUsage = Static<typeof MessageUsageSchema>;

/** Public message projection; provider-specific replay metadata stays on the host. */
export const MessageViewSchema = Type.Object(
  {
    mcpTools: Type.Optional(McpToolSelectionsSchema),
    skills: Type.Optional(SkillSelectionsSchema),
    id,
    sessionId: id,
    branchId: id,
    runId: nullableId,
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
    text: Type.String({ maxLength: 2_000_000 }),
    attachmentIds: Type.Optional(Type.Array(id, { maxItems: 8 })),
    thinking: Type.String({ maxLength: 2_000_000 }),
    createdAt: timestamp,
    finishedAt: Type.Optional(timestamp),
    usage: Type.Optional(MessageUsageSchema),
    status: Type.Union([
      Type.Literal('streaming'),
      Type.Literal('complete'),
      Type.Literal('cancelled'),
      Type.Literal('failed'),
      Type.Literal('interrupted'),
    ]),
    stopReason: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type MessageView = Static<typeof MessageViewSchema>;

/** Durable host outcome; SDK completion and HTTP acceptance do not imply success. */
export const RunViewSchema = Type.Object(
  {
    mcpTools: Type.Optional(McpToolSelectionsSchema),
    skills: Type.Optional(SkillSelectionsSchema),
    id,
    sessionId: id,
    branchId: id,
    providerId: id,
    modelId: id,
    status: Type.Union([
      Type.Literal('running'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
      Type.Literal('failed'),
      Type.Literal('interrupted'),
    ]),
    createdAt: timestamp,
    finishedAt: Type.Union([timestamp, Type.Null()]),
    error: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type RunView = Static<typeof RunViewSchema>;

/** Accepted inputs remain server facts until consumption or explicit deletion. */
export const QueueInputSchema = Type.Object(
  {
    mcpTools: Type.Optional(McpToolSelectionsSchema),
    skills: Type.Optional(SkillSelectionsSchema),
    id,
    sessionId: id,
    text,
    attachmentIds: Type.Optional(Type.Array(id, { maxItems: 8 })),
    mode: Type.Union([Type.Literal('follow-up'), Type.Literal('steer')]),
    providerId: id,
    modelId: id,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type QueueInput = Static<typeof QueueInputSchema>;

/** A revision branch keeps previous input and response history intact. */
export const BranchViewSchema = Type.Object(
  {
    id,
    sessionId: id,
    parentId: nullableId,
    forkMessageId: nullableId,
    createdAt: timestamp,
  },
  { additionalProperties: false },
);
export type BranchView = Static<typeof BranchViewSchema>;

/** A transactional projection and sequence used by both HTTP and SSE clients. */
export const SessionSnapshotSchema = Type.Object(
  {
    session: SessionSummarySchema,
    branches: Type.Array(BranchViewSchema),
    messages: Type.Array(MessageViewSchema),
    runs: Type.Array(RunViewSchema),
    queue: Type.Array(QueueInputSchema),
    tools: Type.Array(ToolCallViewSchema),
    snapshotSeq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type SessionSnapshot = Static<typeof SessionSnapshotSchema>;

/** Public event envelope; only JSON parsed through its owning event type becomes data. */
export const HarnessEventSchema = Type.Object(
  {
    version: Type.Literal(1),
    eventId: id,
    sessionId: id,
    runId: nullableId,
    seq: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 100 }),
    at: timestamp,
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type HarnessEvent = Static<typeof HarnessEventSchema>;

export const SessionCreateInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    providerId: Type.Optional(id),
    modelId: Type.Optional(id),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
    workspaceId: Type.Optional(nullableId),
    approvalMode: Type.Optional(ApprovalModeSchema),
    workMode: Type.Optional(Type.Union([Type.Literal('execute'), Type.Literal('plan')])),
  },
  { additionalProperties: false },
);
export type SessionCreateInput = Static<typeof SessionCreateInputSchema>;
/** Validated owner selection; durable session data never contains omitted defaults. */
export const ResolvedSessionCreateInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    providerId: id,
    modelId: id,
    thinkingLevel: ThinkingLevelSchema,
    workspaceId: nullableId,
    approvalMode: ApprovalModeSchema,
    workMode: Type.Optional(Type.Union([Type.Literal('execute'), Type.Literal('plan')])),
  },
  { additionalProperties: false },
);
export type ResolvedSessionCreateInput = Static<typeof ResolvedSessionCreateInputSchema>;
export const SessionPatchInputSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    providerId: Type.Optional(id),
    modelId: Type.Optional(id),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
    approvalMode: Type.Optional(ApprovalModeSchema),
  },
  { additionalProperties: false },
);
export type SessionPatchInput = Static<typeof SessionPatchInputSchema>;
export const InputRequestSchema = Type.Object(
  {
    mcpTools: Type.Optional(McpToolSelectionsSchema),
    skills: Type.Optional(SkillSelectionsSchema),
    text,
    attachmentIds: Type.Optional(Type.Array(id, { maxItems: 8 })),
    mode: Type.Union([Type.Literal('send'), Type.Literal('follow-up'), Type.Literal('steer')]),
    requestId: id,
  },
  { additionalProperties: false },
);
export type InputRequest = Static<typeof InputRequestSchema>;
export const EditInputSchema = Type.Object(
  {
    mcpTools: Type.Optional(McpToolSelectionsSchema),
    skills: Type.Optional(SkillSelectionsSchema),
    messageId: id,
    text,
    requestId: id,
  },
  { additionalProperties: false },
);
export type EditInput = Static<typeof EditInputSchema>;
export const QueuePatchInputSchema = Type.Object(
  {
    mcpTools: Type.Optional(McpToolSelectionsSchema),
    skills: Type.Optional(SkillSelectionsSchema),
    text,
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type QueuePatchInput = Static<typeof QueuePatchInputSchema>;
