import { Type } from 'typebox';
import {
  FrozenMcpToolSchema,
  FrozenSkillSchema,
  ToolDiscoveryDiagnosticSchema,
} from '@my-pi-harness/protocol';

export const RunAcceptedSchema = Type.Object(
  {
    run: Type.Unknown(),
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
  { message: Type.Unknown() },
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
