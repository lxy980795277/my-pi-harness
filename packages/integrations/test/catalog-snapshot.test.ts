import { expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { decodeMcpCatalog, encodeMcpCatalog } from '../src/index.js';

const tool = {
  name: 'read',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  },
};
const snapshot = {
  tools: [tool],
  resources: [{ uri: 'fixture://read', name: 'Fixture resource' }],
  prompts: [{ name: 'fixture-prompt', arguments: [{ name: 'topic', required: true }] }],
};

it('rebuilds executable TypeBox metadata from official MCP definitions after JSON persistence', () => {
  const restored = decodeMcpCatalog(JSON.stringify(snapshot));
  const parameters = restored.tools[0]?.parameters;
  if (!parameters) throw new Error('Missing restored schema');
  expect(Value.Check(parameters, { value: 'fixture' })).toBe(true);
  expect(Value.Check(parameters, { value: 1 })).toBe(false);
  expect(restored.resources?.[0]?.uri).toBe('fixture://read');
  expect(restored.prompts?.[0]?.arguments?.[0]?.required).toBe(true);
  expect(decodeMcpCatalog(encodeMcpCatalog(restored))).toEqual(restored);
});

it.each([
  'private-provider-token-invalid-json',
  JSON.stringify({ ...snapshot, tools: [tool, tool] }),
  JSON.stringify({ ...snapshot, tools: [{ name: 'invalid', inputSchema: { type: 'string' } }] }),
  JSON.stringify({ ...snapshot, resources: [snapshot.resources[0], snapshot.resources[0]] }),
  JSON.stringify({ ...snapshot, prompts: [snapshot.prompts[0], snapshot.prompts[0]] }),
  JSON.stringify({ ...snapshot, tools: Array.from({ length: 513 }, () => tool) }),
])('rejects corrupt, ambiguous or oversized stored catalogs without echoing content', (data) => {
  expect(() => decodeMcpCatalog(data)).toThrow(
    expect.objectContaining({ code: 'INVALID_CATALOG' }),
  );
  try {
    decodeMcpCatalog(data);
  } catch (error: unknown) {
    expect(error).not.toHaveProperty('cause');
  }
});

it('keeps unsupported schemas visible but never marks them selectable after restoring', () => {
  const restored = decodeMcpCatalog(
    JSON.stringify({
      ...snapshot,
      tools: [
        {
          name: 'unsupported',
          inputSchema: { type: 'object', properties: { value: { $ref: '#/defs/value' } } },
        },
      ],
    }),
  );
  expect(restored.tools[0]).toMatchObject({ supported: false, parameters: null });
});
