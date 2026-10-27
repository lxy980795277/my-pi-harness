import { Type, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_DEPTH = 16;
const COMMON = new Set([
  'type',
  'description',
  'title',
  '$schema',
  'enum',
  'const',
  'anyOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
]);
const NUMBER_OPTIONS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
const ARRAY_OPTIONS = ['minItems', 'maxItems', 'uniqueItems'];
const STRING_OPTIONS = ['minLength', 'maxLength'];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function options(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) if (value[key] !== undefined) result[key] = value[key];
  if (typeof value['description'] === 'string') result['description'] = value['description'];
  if (typeof value['title'] === 'string') result['title'] = value['title'];
  return result;
}
function literal(value: unknown): TSchema {
  if (value === null) return Type.Null();
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return Type.Literal(value);
  throw new Error('Only scalar enum and const values are supported');
}
function translate(value: unknown, depth: number): TSchema {
  if (depth > MAX_DEPTH || !object(value)) throw new Error('Schema depth or object limit exceeded');
  for (const key of Object.keys(value))
    if (!COMMON.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  const dialect = value['$schema'];
  if (
    dialect !== undefined &&
    dialect !== 'http://json-schema.org/draft-07/schema#' &&
    dialect !== 'https://json-schema.org/draft-07/schema'
  )
    throw new Error('Only the JSON Schema draft-07 subset is supported');
  const scalarKeys = ['const', 'enum', 'type', 'description', 'title', '$schema'];
  if (value['const'] !== undefined || Array.isArray(value['enum'])) {
    if (Object.keys(value).some((key) => !scalarKeys.includes(key)))
      throw new Error('Enum or const sibling constraints are unsupported');
    const values = Array.isArray(value['enum']) ? value['enum'] : [value['const']];
    if (value['const'] !== undefined && Array.isArray(value['enum']))
      throw new Error('Combined const and enum are unsupported');
    const type = value['type'];
    if (
      type !== undefined &&
      values.some((entry) => {
        switch (type) {
          case 'null':
            return entry !== null;
          case 'string':
            return typeof entry !== 'string';
          case 'boolean':
            return typeof entry !== 'boolean';
          case 'number':
            return typeof entry !== 'number';
          case 'integer':
            return typeof entry !== 'number' || !Number.isInteger(entry);
          default:
            return true;
        }
      })
    )
      throw new Error('Enum or const type constraints are unsupported');
  }
  if (value['const'] !== undefined) return literal(value['const']);
  if (Array.isArray(value['enum'])) {
    if (value['enum'].length === 0 || value['enum'].length > 256)
      throw new Error('Enum size is unsupported');
    return Type.Union(value['enum'].map(literal));
  }
  if (Array.isArray(value['anyOf'])) {
    if (value['anyOf'].length === 0 || value['anyOf'].length > 32)
      throw new Error('Union size is unsupported');
    const sibling = Object.keys(value).some(
      (key) => !['anyOf', 'description', 'title', '$schema'].includes(key),
    );
    if (sibling) throw new Error('Union sibling constraints are unsupported');
    return Type.Union(
      value['anyOf'].map((entry) => translate(entry, depth + 1)),
      options(value, []),
    );
  }
  if (Array.isArray(value['type'])) {
    const types: unknown[] = value['type'];
    if (types.length === 0 || types.length > 7 || types.some((entry) => typeof entry !== 'string'))
      throw new Error('Invalid type union');
    return Type.Union(types.map((entry) => translate({ ...value, type: entry }, depth + 1)));
  }
  const byType: Record<string, readonly string[]> = {
    object: ['properties', 'required', 'additionalProperties'],
    array: ['items', ...ARRAY_OPTIONS],
    string: STRING_OPTIONS,
    number: NUMBER_OPTIONS,
    integer: NUMBER_OPTIONS,
    boolean: [],
    null: [],
  };
  const allowed = typeof value['type'] === 'string' ? byType[value['type']] : undefined;
  if (
    allowed === undefined ||
    Object.keys(value).some(
      (key) => !['type', 'description', 'title', '$schema', ...allowed].includes(key),
    )
  )
    throw new Error('Mixed-type schema constraints are unsupported');
  if (
    value['multipleOf'] !== undefined &&
    (typeof value['multipleOf'] !== 'number' || value['multipleOf'] <= 0)
  )
    throw new Error('multipleOf must be positive');
  for (const key of [...NUMBER_OPTIONS, 'minItems', 'maxItems', 'minLength', 'maxLength']) {
    const limit = value[key];
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit)))
      throw new Error('Schema limits must be finite numbers');
    if (
      ['minItems', 'maxItems', 'minLength', 'maxLength'].includes(key) &&
      limit !== undefined &&
      (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0)
    )
      throw new Error('Schema lengths must be nonnegative integers');
  }
  switch (value['type']) {
    case 'object': {
      const properties = value['properties'] ?? {};
      if (!object(properties)) throw new Error('Object properties must be an object');
      const required = value['required'] ?? [];
      if (
        !Array.isArray(required) ||
        required.some((name) => typeof name !== 'string' || !Object.hasOwn(properties, name)) ||
        new Set(required).size !== required.length
      )
        throw new Error('Object required fields are invalid');
      const translated = Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => {
          if (['__proto__', 'constructor', 'prototype'].includes(name))
            throw new Error('Reserved object properties are unsupported');
          const property = translate(schema, depth + 1);
          return [name, required.includes(name) ? property : Type.Optional(property)];
        }),
      );
      const additional = value['additionalProperties'];
      if (additional !== undefined && typeof additional !== 'boolean' && !object(additional))
        throw new Error('Invalid additionalProperties');
      return Type.Object(translated, {
        ...options(value, []),
        additionalProperties: object(additional)
          ? translate(additional, depth + 1)
          : additional !== false,
      });
    }
    case 'array':
      if (!object(value['items'])) throw new Error('Arrays require one item schema');
      if (value['uniqueItems'] !== undefined && typeof value['uniqueItems'] !== 'boolean')
        throw new Error('Invalid uniqueItems');
      return Type.Array(translate(value['items'], depth + 1), options(value, ARRAY_OPTIONS));
    case 'string':
      return Type.String(options(value, STRING_OPTIONS));
    case 'number':
      return Type.Number(options(value, NUMBER_OPTIONS));
    case 'integer':
      return Type.Integer(options(value, NUMBER_OPTIONS));
    case 'boolean':
      return Type.Boolean(options(value, []));
    case 'null':
      return Type.Null(options(value, []));
    default:
      throw new Error('Schema type must be explicit');
  }
}

/** Constructs genuine TypeBox schemas and compiles the exact subset used by Pi argument validation. */
export function compileMcpInputSchema(input: unknown): TSchema {
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_SCHEMA_BYTES)
    throw new Error('Input schema exceeds 64 KiB');
  if (!object(input) || input['type'] !== 'object')
    throw new Error('Input schema root must be an object');
  const schema = translate(input, 0);
  Compile(schema);
  return schema;
}
