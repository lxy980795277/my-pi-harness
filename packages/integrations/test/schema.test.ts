import { describe, expect, it } from 'vitest';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import { compileMcpInputSchema } from '../src/index.js';

describe('bounded external JSON Schema to real TypeBox schemas', () => {
  it('preserves required/optional fields, array constraints, scalar enums and nested objects for actual Pi validation', () => {
    const parameters = compileMcpInputSchema({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        optional: { type: 'integer', minimum: 1 },
        items: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['read', 'write'] } },
            required: ['action'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'items'],
      additionalProperties: false,
    });
    const tool = { name: 'fixture', description: 'fixture', parameters };
    expect(
      validateToolArguments(tool, {
        type: 'toolCall',
        id: 'call',
        name: 'fixture',
        arguments: { name: 'ok', items: [{ action: 'read' }] },
      }),
    ).toEqual({ name: 'ok', items: [{ action: 'read' }] });
    for (const arguments_ of [
      { name: 'x', items: [] },
      { name: 'ok', items: [{ action: 'other' }] },
      { name: 'ok', optional: 0, items: [] },
      { name: 'ok', items: [], unexpected: true },
    ]) {
      expect(() => {
        validateToolArguments(tool, {
          type: 'toolCall',
          id: 'call',
          name: 'fixture',
          arguments: arguments_,
        });
      }).toThrow();
      expect(Value.Check(parameters, arguments_)).toBe(false);
    }
  });
  const unsupportedSchemas: unknown[] = [
    { type: 'object', $ref: 'https://example.test/schema' },
    { type: 'object', properties: { value: { type: 'string', pattern: '(a+)+$' } } },
    { type: 'object', properties: { value: { enum: ['ok'], minLength: 20 } } },
    { type: 'object', properties: { value: { type: 'string', minimum: 3 } } },
    { type: 'object', properties: { value: { type: 'string', enum: [4] } } },
    { type: 'object', properties: {}, required: ['missing'] },
    { type: 'object', properties: { constructor: { type: 'string' } } },
    { type: 'object', $schema: 'https://json-schema.org/draft/2020-12/schema' },
  ];
  it.each(unsupportedSchemas)(
    'does not silently weaken unsupported or contradictory schemas %#',
    (schema) => {
      expect(() => compileMcpInputSchema(schema)).toThrow();
    },
  );
  it('bounds depth and schema bytes before compilation', () => {
    let schema: unknown = { type: 'string' };
    for (let depth = 0; depth < 18; depth += 1)
      schema = { type: 'object', properties: { nested: schema } };
    expect(() => compileMcpInputSchema(schema)).toThrow();
    expect(() =>
      compileMcpInputSchema({ type: 'object', description: 'x'.repeat(65536) }),
    ).toThrow();
  });
});
