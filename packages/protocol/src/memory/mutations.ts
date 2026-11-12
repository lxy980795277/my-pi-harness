import { type Static, Type } from 'typebox';
import { MemoryCategorySchema, MemoryModeSchema } from './memory';

export type MemorySaveInput = Static<typeof MemorySaveInputSchema>;
export type MemoryAgentUpdateInput = Static<typeof MemoryAgentUpdateInputSchema>;
export type MemoryAgentDeleteInput = Static<typeof MemoryAgentDeleteInputSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const content = {
  category: MemoryCategorySchema,
  body: Type.String({ minLength: 1, maxLength: 16_000 }),
  mode: Type.Optional(MemoryModeSchema),
};

/** Workspace identity is resolved from the active host session, never from model arguments. */
export const MemorySaveInputSchema = Type.Object(
  { scope: Type.Union([Type.Literal('user'), Type.Literal('workspace')]), ...content },
  { additionalProperties: false },
);

export const MemoryAgentUpdateInputSchema = Type.Object(
  { memoryId: id, expectedRevision: revision, ...content },
  { additionalProperties: false },
);

export const MemoryAgentDeleteInputSchema = Type.Object(
  { memoryId: id, expectedRevision: revision },
  { additionalProperties: false },
);
