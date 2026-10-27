import { type Static, Type } from 'typebox';
import {
  BranchViewSchema,
  MessageViewSchema,
  QueueInputSchema,
  RunViewSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
} from './sessions.js';
import { ToolCallViewSchema } from '../tools/tools.js';

export type SessionChange = Static<typeof SessionChangeSchema>;
export type SessionPatch = Static<typeof SessionPatchSchema>;
export type SessionStreamUpdate = Static<typeof SessionStreamUpdateSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const sequence = Type.Integer({ minimum: 0 });
const index = Type.Integer({ minimum: 0 });
const options = { additionalProperties: false };

/** One public projection change; an append never repeats the preceding message body. */
export const SessionChangeSchema = Type.Union([
  Type.Object({ type: Type.Literal('message.set'), index, message: MessageViewSchema }, options),
  Type.Object(
    {
      type: Type.Literal('message.append'),
      id,
      textDelta: Type.String({ maxLength: 2_000_000 }),
      thinkingDelta: Type.String({ maxLength: 2_000_000 }),
    },
    options,
  ),
  Type.Object({ type: Type.Literal('message.remove'), id }, options),
  Type.Object({ type: Type.Literal('branch.set'), index, branch: BranchViewSchema }, options),
  Type.Object({ type: Type.Literal('branch.remove'), id }, options),
  Type.Object({ type: Type.Literal('run.set'), index, run: RunViewSchema }, options),
  Type.Object({ type: Type.Literal('run.remove'), id }, options),
  Type.Object({ type: Type.Literal('queue.set'), index, input: QueueInputSchema }, options),
  Type.Object({ type: Type.Literal('queue.remove'), id }, options),
  Type.Object({ type: Type.Literal('tool.set'), index, tool: ToolCallViewSchema }, options),
  Type.Object({ type: Type.Literal('tool.remove'), id }, options),
]);

/** A bounded transition for exactly one selected branch and committed sequence interval. */
export const SessionPatchSchema = Type.Object(
  {
    kind: Type.Literal('patch'),
    sessionId: id,
    branchId: id,
    baseSeq: sequence,
    snapshotSeq: sequence,
    session: SessionSummarySchema,
    changes: Type.Array(SessionChangeSchema, { maxItems: 256 }),
  },
  options,
);

/** Initial/reconnected streams and branch changes replace their complete projection baseline. */
export const SessionStreamUpdateSchema = Type.Union([
  Type.Object({ kind: Type.Literal('snapshot'), snapshot: SessionSnapshotSchema }, options),
  SessionPatchSchema,
]);
