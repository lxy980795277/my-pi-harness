import { Type, type Static } from 'typebox';

/** Durable assistant call identity; raw arguments may be rejected before execution. */
export const StoredToolIntentSchema = Type.Object({
  type: Type.Literal('toolCall'),
  id: Type.String({ minLength: 1, maxLength: 512 }),
  name: Type.String({ minLength: 1, maxLength: 2048 }),
  arguments: Type.Unknown(),
});
export type StoredToolIntent = Static<typeof StoredToolIntentSchema>;

/** Host-only canonical result; never part of HTTP/SSE snapshots. */
export const StoredToolResultSchema = Type.Object(
  {
    toolResultVersion: Type.Literal(1),
    providerCallId: Type.String({ minLength: 1, maxLength: 512 }),
    toolName: Type.String({ minLength: 1, maxLength: 2048 }),
    content: Type.Array(
      Type.Union([
        Type.Object(
          { type: Type.Literal('text'), text: Type.String({ maxLength: 2_000_000 }) },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal('image'),
            data: Type.String({ maxLength: 8_000_000 }),
            mimeType: Type.String({ maxLength: 100 }),
          },
          { additionalProperties: false },
        ),
      ]),
      { maxItems: 128 },
    ),
    isError: Type.Boolean(),
    at: Type.Integer({ minimum: 0 }),
    origin: Type.Union([Type.Literal('server'), Type.Literal('host'), Type.Literal('tool')]),
    outcome: Type.Enum(['completed', 'failed', 'denied', 'cancelled', 'interrupted', 'unknown']),
  },
  { additionalProperties: false },
);
export type StoredToolResult = Static<typeof StoredToolResultSchema>;
