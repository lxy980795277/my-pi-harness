import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

/** Validates a public wire response before it enters the request cache. */
export const parseResponse = <Schema extends TSchema>(
  schema: Schema,
  data: unknown,
  errorMessage = '本机服务返回了不兼容的数据，请确认前后端版本一致。',
): Static<Schema> => {
  if (!Value.Check(schema, data)) {
    throw new Error(errorMessage);
  }
  return data;
};
