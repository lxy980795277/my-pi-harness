import { Type } from 'typebox';

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
    mcpBindings: Type.Optional(Type.String({ maxLength: 2_000_000 })),
    candidateBindings: Type.Optional(Type.String({ maxLength: 4_000_000 })),
    skillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
    mentionedSkillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
    inheritedSkillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
    discoveryDiagnostics: Type.Optional(Type.String({ maxLength: 300_000 })),
  },
  { additionalProperties: false },
);
