import { type Static, Type } from 'typebox';

/** The session policy never grants arbitrary host access. */
export const ApprovalModeSchema = Type.Union([Type.Literal('ask'), Type.Literal('read-only')]);
export type ApprovalMode = Static<typeof ApprovalModeSchema>;

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
      Type.Literal('awaiting_approval'),
      Type.Literal('running'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('denied'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
    ]),
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
