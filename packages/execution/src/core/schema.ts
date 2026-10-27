import { Type, type TSchema } from 'typebox';

/** Preserve each property's TypeBox type while rejecting undeclared object fields. */
export function strictObjectSchema<T extends Record<string, TSchema>>(
  properties: T,
): ReturnType<typeof Type.Object<T>> {
  return Type.Object(properties, { additionalProperties: false });
}
