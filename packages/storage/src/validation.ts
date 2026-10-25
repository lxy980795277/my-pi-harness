import { type Static, type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';
import { StorageError } from './errors.js';

/**
 * Validate durable or event data against its owning schema without casting unknown input.
 * @param schema The protocol or storage-owned schema.
 * @param value A decoded durable record or event payload.
 * @returns A validated value; damaged records fail instead of disappearing from projections.
 */
export function checked<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value))
    throw new StorageError('INVALID_RECORD', 'Stored or submitted data failed validation');
  return value;
}

/** Reject data that JSON encoding would silently drop or change. */
export function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value) || ancestors.size > 100) {
    throw new StorageError('INVALID_RECORD', 'Event data must contain finite, acyclic JSON values');
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new StorageError('INVALID_RECORD', 'Event data must contain plain JSON objects');
  }
  ancestors.add(value);
  for (const entry of Object.values(value)) assertJson(entry, ancestors);
  ancestors.delete(value);
}

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
  },
  { additionalProperties: false },
);
