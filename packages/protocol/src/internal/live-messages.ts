import { type Static, Type } from 'typebox';

export type LiveMessageDelta = Static<typeof LiveMessageDeltaSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const delta = Type.String({ maxLength: 2_000_000 });

/** In-memory text appended to one already recorded streaming message and its owning run. */
export const LiveMessageDeltaSchema = Type.Object(
  {
    runId: id,
    messageId: id,
    text: Type.Optional(delta),
    thinking: Type.Optional(delta),
  },
  {
    additionalProperties: false,
    anyOf: [{ required: ['text'] }, { required: ['thinking'] }],
  },
);
