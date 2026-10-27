import { type Static, Type } from 'typebox';

export type ApprovalMode = Static<typeof ApprovalModeSchema>;
export type ToolApproval = Static<typeof ToolApprovalSchema>;
export type ToolSource = Static<typeof ToolSourceSchema>;
export type ToolBinding = Static<typeof ToolBindingSchema>;
export type ToolDispatch = Static<typeof ToolDispatchSchema>;
export type ToolCallRecord = Static<typeof ToolCallRecordSchema>;
export type ToolCallView = Static<typeof ToolCallViewSchema>;
export type ToolDecisionInput = Static<typeof ToolDecisionInputSchema>;

/** New choices are explicit; legacy read-only sessions retain their original restrictions. */
export const ApprovalModeSchema = Type.Union([
  Type.Literal('ask'),
  Type.Literal('auto'),
  Type.Literal('full-access'),
  Type.Literal('read-only'),
]);

/** One recorded decision; AI review inputs remain private host events. */
export const ToolApprovalSchema = Type.Object(
  {
    source: Type.Union([Type.Literal('user'), Type.Literal('ai'), Type.Literal('full-access')]),
    decision: Type.Union([Type.Literal('allow'), Type.Literal('deny'), Type.Literal('ask')]),
    reason: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  },
  { additionalProperties: false },
);

const id = Type.String({ minLength: 1, maxLength: 160 });
const fingerprint = Type.String({ pattern: '^[a-f0-9]{64}$' });

/** Durable routing identity is independent from a user-editable display name. */
export const ToolSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('session') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('workspace') }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal('mcp'),
      serverId: id,
      serverRevision: Type.Integer({ minimum: 1 }),
      remoteToolName: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
]);

/** Rejected model calls have no executable source or invented definition fingerprint. */
export const ToolBindingSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('accepted'), source: ToolSourceSchema, fingerprint },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('rejected'), reason: Type.String({ minLength: 1, maxLength: 2000 }) },
    { additionalProperties: false },
  ),
]);

/** A committed send barrier means possible dispatch, never confirmed server receipt. */
export const ToolDispatchSchema = Type.Union([
  Type.Object({ state: Type.Literal('not_applicable') }, { additionalProperties: false }),
  Type.Object({ state: Type.Literal('not_started') }, { additionalProperties: false }),
  Type.Object(
    {
      state: Type.Literal('may_have_started'),
      attemptId: id,
      at: Type.Integer({ minimum: 0 }),
      confirmedNotWritten: Type.Optional(Type.Literal(true)),
    },
    { additionalProperties: false },
  ),
]);

/** Committed tool event fields; binary model content remains in private context. */
export const ToolCallRecordSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    sessionId: Type.String({ minLength: 1, maxLength: 160 }),
    runId: Type.String({ minLength: 1, maxLength: 160 }),
    branchId: Type.String({ minLength: 1, maxLength: 160 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    arguments: Type.Record(Type.String(), Type.Unknown()),
    binding: ToolBindingSchema,
    dispatch: ToolDispatchSchema,
    status: Type.Union([
      Type.Literal('reviewing'),
      Type.Literal('awaiting_approval'),
      Type.Literal('running'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('denied'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
      Type.Literal('unknown'),
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

/** Snapshot tool activity includes its persisted assistant anchor for timeline placement. */
export const ToolCallViewSchema = Type.Object(
  {
    ...ToolCallRecordSchema.properties,
    afterMessageId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);

export const ToolDecisionInputSchema = Type.Object(
  { decision: Type.Union([Type.Literal('allow'), Type.Literal('deny')]) },
  { additionalProperties: false },
);
