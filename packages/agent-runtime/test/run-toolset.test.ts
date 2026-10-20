import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { RunToolset, type RunToolSelection } from '../src/run-toolset.js';

describe('accepted Run tool definitions', () => {
  it('owns a deep frozen copy while retaining TypeBox optional and kind metadata', () => {
    const parameters = Type.Object(
      { path: Type.String(), count: Type.Optional(Type.Integer({ minimum: 1 })) },
      { additionalProperties: false },
    );
    const definition = { name: 'read', description: 'Read one entry', parameters };
    const selections: RunToolSelection[] = [{ source: 'workspace', definition }];
    const toolset = new RunToolset(selections);
    const selected = toolset.require('read');
    definition.name = 'changed';
    definition.description = 'Changed description';
    Object.assign(parameters.properties.path, { type: 'number' });
    selections.length = 0;

    expect(toolset.definitions).toEqual([
      {
        name: 'read',
        description: 'Read one entry',
        parameters: Type.Object(
          { path: Type.String(), count: Type.Optional(Type.Integer({ minimum: 1 })) },
          { additionalProperties: false },
        ),
      },
    ]);
    expect(selected.definition).toBe(toolset.definitions[0]);
    expect(Reflect.get(selected.definition.parameters, '~kind')).toBe('Object');
    const properties = (selected.definition.parameters as typeof parameters).properties;
    expect(Reflect.get(properties.count, '~optional')).toBe(true);
    expect(Object.isFrozen(properties.count)).toBe(true);
    expect(() => Object.assign(selected, { source: 'session' })).toThrow(TypeError);
    expect(() => Object.assign(properties.path, { type: 'number' })).toThrow(TypeError);
    expect(Value.Check(selected.definition.parameters, { path: 'file.txt' })).toBe(true);
    const validator = Compile(selected.definition.parameters);
    expect(validator.Check({ path: 'file.txt', count: 2 })).toBe(true);
    expect(validator.Check({ path: 'file.txt', count: 0 })).toBe(false);
    expect(validator.Check({ path: 3 })).toBe(false);
  });

  it('fingerprints source and model definition without depending on object key insertion order', () => {
    const definition = {
      name: 'read',
      description: 'Read one entry',
      parameters: Type.Object({ path: Type.String() }),
    };
    const fingerprint = new RunToolset([{ source: 'workspace', definition }]).require(
      'read',
    ).fingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(
      new RunToolset([
        {
          definition: {
            parameters: definition.parameters,
            description: definition.description,
            name: definition.name,
          },
          source: 'workspace',
        },
      ]).require('read').fingerprint,
    ).toBe(fingerprint);
    expect(
      new RunToolset([{ source: 'session', definition }]).require('read').fingerprint,
    ).not.toBe(fingerprint);
    expect(
      new RunToolset([
        { source: 'workspace', definition: { ...definition, description: 'Different action' } },
      ]).require('read').fingerprint,
    ).not.toBe(fingerprint);
    expect(
      new RunToolset([
        {
          source: 'workspace',
          definition: { ...definition, parameters: Type.Object({ path: Type.Integer() }) },
        },
      ]).require('read').fingerprint,
    ).not.toBe(fingerprint);
  });

  it('rejects duplicate names across sources before constructing an executable route', () => {
    const definition = { name: 'read', description: 'Read', parameters: Type.Object({}) };
    expect(
      () =>
        new RunToolset([
          { source: 'session', definition },
          { source: 'workspace', definition },
        ]),
    ).toThrow('工具名称重复');
  });

  it('keeps an explicit empty collection and refuses routes outside the accepted set', () => {
    const empty = new RunToolset([]);
    expect(empty.definitions).toEqual([]);
    expect(empty.records).toEqual([]);
    expect(() => empty.require('read_file')).toThrow('本次运行未提供工具');
    expect(Object.isFrozen(empty.definitions)).toBe(true);
    const toolset = new RunToolset([
      {
        source: 'workspace',
        definition: { name: 'read_file', description: 'Read', parameters: Type.Object({}) },
      },
    ]);
    expect(() => toolset.require('write_file')).toThrow('本次运行未提供工具');
  });
});
