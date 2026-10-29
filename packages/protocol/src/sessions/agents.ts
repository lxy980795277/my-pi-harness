import { Type, type Static } from 'typebox';
import { ThinkingLevelSchema } from '../application/models.js';
import { WorkStateSchema } from './context.js';
import { MessageUsageSchema, MessageViewSchema, RunViewSchema } from './sessions.js';
import { ToolCallViewSchema } from '../tools/tools.js';

export type AgentLimits = Static<typeof AgentLimitsSchema>;
export type AgentRole = Static<typeof AgentRoleSchema>;
export type AgentSettings = Static<typeof AgentSettingsSchema>;
export type AgentSettingsInput = Static<typeof AgentSettingsInputSchema>;
export type AgentTask = Static<typeof AgentTaskSchema>;
export type AgentTaskSummary = Static<typeof AgentTaskSummarySchema>;
export type AgentTaskDetail = Static<typeof AgentTaskDetailSchema>;
export type AgentTaskList = Static<typeof AgentTaskListSchema>;
export type AgentMessageTarget = Static<typeof AgentMessageTargetSchema>;
export type AgentMessage = Static<typeof AgentMessageSchema>;
export type AgentMessageInput = Static<typeof AgentMessageInputSchema>;
export type AgentTaskStop = Static<typeof AgentTaskStopSchema>;
export type AgentTaskQuery = Static<typeof AgentTaskQuerySchema>;
export type AgentBoard = Static<typeof AgentBoardSchema>;
export type AgentBoardQuery = Static<typeof AgentBoardQuerySchema>;
export type AgentChange = Static<typeof AgentChangeSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const timestamp = Type.Integer({ minimum: 0 });
const nullableTimestamp = Type.Union([timestamp, Type.Null()]);

export const AgentLimitsSchema = Type.Object(
  {
    maxTasks: Type.Integer({ minimum: 1, maximum: 64 }),
    maxDepth: Type.Integer({ minimum: 1, maximum: 8 }),
    maxConcurrentRequests: Type.Integer({ minimum: 1, maximum: 8 }),
    maxTurns: Type.Integer({ minimum: 1, maximum: 32 }),
    timeoutMs: Type.Integer({ minimum: 1000, maximum: 3_600_000 }),
    tokenBudget: Type.Integer({ minimum: 1024, maximum: 2_000_000 }),
    maxOutputTokens: Type.Integer({ minimum: 128, maximum: 32_768 }),
  },
  { additionalProperties: false },
);

/** Frozen role selection never contains provider credentials or grants extra capabilities. */
export const AgentRoleSchema = Type.Object(
  {
    id,
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.String({ maxLength: 1000 }),
    instructions: Type.String({ minLength: 1, maxLength: 8000 }),
    enabled: Type.Boolean(),
    access: Type.Union([Type.Literal('read-only'), Type.Literal('write')]),
    providerId: nullableId,
    modelId: nullableId,
    thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const AgentSettingsSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    enabled: Type.Boolean(),
    limits: AgentLimitsSchema,
    roles: Type.Array(AgentRoleSchema, { minItems: 1, maxItems: 16 }),
  },
  { additionalProperties: false },
);
export const AgentSettingsInputSchema = AgentSettingsSchema;

/** A task's source tool is the sole durable parent and branch provenance. */
export const AgentTaskSchema = Type.Object(
  {
    id,
    sourceToolCallId: id,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    role: AgentRoleSchema,
    limits: AgentLimitsSchema,
    createdAt: timestamp,
  },
  { additionalProperties: false },
);

export const AgentTaskWaitingSchema = Type.Union([
  Type.Literal('model'),
  Type.Literal('children'),
  Type.Literal('user'),
  Type.Literal('approval'),
  Type.Null(),
]);
export const AgentTaskOutcomeSchema = Type.Union([
  Type.Literal('completed'),
  Type.Literal('cancelled'),
  Type.Literal('failed'),
  Type.Literal('interrupted'),
]);

/** Rebuildable task state; ancestry and aggregate usage are not repeated in the journal. */
export const AgentTaskSummarySchema = Type.Object(
  {
    ...AgentTaskSchema.properties,
    sessionId: id,
    branchId: id,
    parentRunId: id,
    parentTaskId: nullableId,
    rootRunId: id,
    latestRunId: nullableId,
    status: Type.Union([
      Type.Literal('queued'),
      Type.Literal('running'),
      Type.Literal('waiting'),
      AgentTaskOutcomeSchema,
    ]),
    waiting: AgentTaskWaitingSchema,
    updatedAt: timestamp,
    finishedAt: nullableTimestamp,
    closedAt: nullableTimestamp,
    closeReason: Type.Union([AgentTaskOutcomeSchema, Type.Null()]),
    error: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    usage: Type.Union([MessageUsageSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const AgentMessageTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('run'), runId: id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('task'), taskId: id }, { additionalProperties: false }),
]);
export const AgentMessageQueuedSchema = Type.Object(
  {
    id,
    sourceRunId: id,
    target: AgentMessageTargetSchema,
    text: Type.String({ minLength: 1, maxLength: 32_000 }),
    createdAt: timestamp,
  },
  { additionalProperties: false },
);
export const AgentMessageSchema = Type.Object(
  {
    ...AgentMessageQueuedSchema.properties,
    status: Type.Union([
      Type.Literal('queued'),
      Type.Literal('consumed'),
      Type.Literal('undelivered'),
    ]),
    consumedRunId: nullableId,
    finishedAt: nullableTimestamp,
    reason: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const AgentTaskDetailSchema = Type.Object(
  {
    task: AgentTaskSummarySchema,
    messages: Type.Array(MessageViewSchema, { maxItems: 200 }),
    runs: Type.Array(RunViewSchema),
    tools: Type.Array(ToolCallViewSchema),
    work: WorkStateSchema,
    snapshotSeq: Type.Integer({ minimum: 0 }),
    liveRevision: Type.Integer({ minimum: 0 }),
    nextCursor: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const AgentTaskListSchema = Type.Object(
  {
    tasks: Type.Array(AgentTaskSummarySchema),
    snapshotSeq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const AgentTaskQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);
export const AgentBoardQuerySchema = Type.Object(
  {
    filter: Type.Optional(
      Type.Union([
        Type.Literal('all'),
        Type.Literal('active'),
        Type.Literal('pending'),
        Type.Literal('ended'),
      ]),
    ),
    workspaceId: Type.Optional(id),
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);
export const AgentBoardSchema = Type.Object(
  {
    tasks: Type.Array(AgentTaskSummarySchema, { maxItems: 200 }),
    nextCursor: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const AgentChangeSchema = Type.Object(
  { kind: Type.Union([Type.Literal('ready'), Type.Literal('changed')]) },
  { additionalProperties: false },
);
export const AgentTaskStopSchema = Type.Object(
  { expectedRunId: nullableId },
  { additionalProperties: false },
);
export const AgentMessageInputSchema = Type.Object(
  {
    requestId: id,
    text: Type.String({ minLength: 1, maxLength: 32_000 }),
    continue: Type.Boolean(),
    expectedRunId: nullableId,
  },
  { additionalProperties: false },
);

/** Resolve application-owned defaults before configuration is used or persisted. */
export function defaultAgentSettings(): AgentSettings {
  return {
    revision: 0,
    enabled: true,
    limits: {
      maxTasks: 16,
      maxDepth: 3,
      maxConcurrentRequests: 4,
      maxTurns: 16,
      timeoutMs: 600_000,
      tokenBudget: 200_000,
      maxOutputTokens: 4096,
    },
    roles: [
      {
        id: 'researcher',
        name: '调查',
        description: '读取资料、核对来源并给出有依据的结论。',
        instructions: '独立核对分配的任务，保持只读。区分已验证事实和推测，返回简洁结论与来源。',
        enabled: true,
        access: 'read-only',
        providerId: null,
        modelId: null,
        thinkingLevel: null,
      },
      {
        id: 'reviewer',
        name: '审查',
        description: '审查实现、定位风险并报告可复现的问题。',
        instructions: '只读审查分配的内容，优先报告有证据的问题和影响，说明未验证的部分。',
        enabled: true,
        access: 'read-only',
        providerId: null,
        modelId: null,
        thinkingLevel: null,
      },
      {
        id: 'worker',
        name: '执行',
        description: '在父任务授予的范围内完成修改并验证结果。',
        instructions:
          '完成分配的任务，遵守继承的权限、写入拥有权与预算。报告实际修改、验证及剩余问题。',
        enabled: true,
        access: 'write',
        providerId: null,
        modelId: null,
        thinkingLevel: null,
      },
    ],
  };
}
