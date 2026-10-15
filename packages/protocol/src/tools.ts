import { type Static, Type } from 'typebox';

/** New choices are explicit; legacy read-only sessions retain their original restrictions. */
export const ApprovalModeSchema = Type.Union([
  Type.Literal('ask'),
  Type.Literal('auto'),
  Type.Literal('full-access'),
  Type.Literal('read-only'),
]);
export type ApprovalMode = Static<typeof ApprovalModeSchema>;

/** One recorded decision; AI review inputs remain private host events. */
export const ToolApprovalSchema = Type.Object(
  {
    source: Type.Union([Type.Literal('user'), Type.Literal('ai'), Type.Literal('full-access')]),
    decision: Type.Union([Type.Literal('allow'), Type.Literal('deny'), Type.Literal('ask')]),
    reason: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ToolApproval = Static<typeof ToolApprovalSchema>;

/** Committed tool event fields; binary model content remains in private context. */
export const ToolCallRecordSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    sessionId: Type.String({ minLength: 1, maxLength: 160 }),
    runId: Type.String({ minLength: 1, maxLength: 160 }),
    branchId: Type.String({ minLength: 1, maxLength: 160 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    arguments: Type.Record(Type.String(), Type.Unknown()),
    status: Type.Union([
      Type.Literal('reviewing'),
      Type.Literal('awaiting_approval'),
      Type.Literal('running'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('denied'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
    ]),
    approval: Type.Optional(ToolApprovalSchema),
    summary: Type.String({ maxLength: 4000 }),
    result: Type.Union([Type.String({ maxLength: 128_000 }), Type.Null()]),
    diff: Type.Union([Type.String({ maxLength: 128_000 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ToolCallRecord = Static<typeof ToolCallRecordSchema>;

/** Snapshot tool activity includes its persisted assistant anchor for timeline placement. */
export const ToolCallViewSchema = Type.Object(
  {
    ...ToolCallRecordSchema.properties,
    afterMessageId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);
export type ToolCallView = Static<typeof ToolCallViewSchema>;

export const ToolDecisionInputSchema = Type.Object(
  { decision: Type.Union([Type.Literal('allow'), Type.Literal('deny')]) },
  { additionalProperties: false },
);
export type ToolDecisionInput = Static<typeof ToolDecisionInputSchema>;
