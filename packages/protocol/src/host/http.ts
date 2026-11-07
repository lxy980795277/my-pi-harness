import { Type, type Static } from 'typebox';

export type ApiError = Static<typeof ApiErrorSchema>;

/** Public failures expose only an owned code and safe message; HTTP status stays in transport. */
export const ApiErrorSchema = Type.Object(
  { code: Type.String(), message: Type.String() },
  { additionalProperties: false },
);
