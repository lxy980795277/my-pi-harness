import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { declarationOrderViolations } from '../../scripts/source-declarations.mjs';

function inspect(content, filename = 'module.ts') {
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  return declarationOrderViolations(source);
}

describe('module declaration groups', () => {
  it('allows types to refer to later schemas without executing a forward reference', () => {
    expect(
      inspect(`
        import { Type, type Static } from 'typebox';
        export type Record = Static<typeof RecordSchema>;
        interface Options { record: Record }
        const LIMIT = 64;
        export const RecordSchema = Type.Object({ value: Type.String({ maxLength: LIMIT }) });
        let active = 0;
        function read(options: Options) { return options.record; }
        export class Reader {}
      `),
    ).toEqual([]);
  });

  it.each([
    'const LIMIT = 64; type Options = { limit: number };',
    'const Schema = Type.Object({}); export type Value = Static<typeof Schema>;',
    'let active = 0; interface Request { id: string }',
    'function read() {} interface Options { enabled: boolean }',
    'class Reader {} type Options = Reader;',
    'const read = () => 1; type Result = ReturnType<typeof read>;',
    'initialize(); type Options = { enabled: boolean };',
  ])('rejects a late module type: %s', (content) => {
    expect(inspect(content)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('type/interface') }),
    ]);
  });

  it('keeps literal, schema, factory, map/filter and callback objects in the data group', () => {
    expect(
      inspect(`
        type Handler = () => number;
        const LIMIT = 64;
        const PATH = new URL('./resources/', import.meta.url);
        const Schema = Type.Object({ enabled: Type.Boolean() });
        const DEFINITIONS = loadDeclarations().map((entry) => entry).filter(Boolean);
        const HANDLERS = { read() { return LIMIT; }, write: () => LIMIT };
        const state = createStore(() => ({ enabled: true }));
        let current = null;
        function run() {}
      `),
    ).toEqual([]);
  });

  it.each([
    'function read() {} const LIMIT = 64;',
    'class Reader {} const ENTRIES = [{ id: 1 }, { id: 2 }];',
    'const read = () => 1; const OPTIONS = { enabled: true };',
    'function read() {} const Schema = Type.Object({});',
    'function read() {} const DEFINITIONS = loadDeclarations().map((entry) => entry);',
    'function read() {} const OPTIONS = { read() {}, write: () => 1 };',
    'initialize(); const LIMIT = 64;',
    'let active = 0; const LIMIT = 64;',
    'const read = () => 1, LIMIT = 64;',
  ])('rejects late data independent of initializer complexity: %s', (content) => {
    expect(inspect(content)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('非函数 const') }),
    ]);
  });

  it.each([
    '() => 1',
    'function read() { return 1; }',
    'class Reader {}',
    '((() => 1))',
    '((() => 1) as Handler)',
    '((() => 1) satisfies Handler)',
    '(<Handler>(() => 1))',
    '((() => 1)!)',
  ])('recognizes wrapped function/class initializer %s as implementation', (initializer) => {
    expect(inspect(`const read = ${initializer}; const LIMIT = 64;`)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('非函数 const') }),
    ]);
  });

  it('ignores import and export metadata between declaration groups', () => {
    expect(
      inspect(`
        import { Type } from 'typebox';
        export type { External } from './external.js';
        interface Options { enabled: boolean }
        export { Type };
        const LIMIT = 64;
        export * from './other.js';
        export { type Options };
        function read() { return LIMIT; }
        export type { Another } from './another.js';
        export { read };
        export default read;
      `),
    ).toEqual([]);
  });

  it('does not let neutral exports reset an existing implementation group', () => {
    expect(inspect("function run() {} export * from './other.js'; const LIMIT = 1;")).toEqual([
      expect.objectContaining({ message: expect.stringContaining('非函数 const') }),
    ]);
  });

  it('keeps module state together before implementation', () => {
    expect(
      inspect('const LIMIT = 1; let current = null; var active = 0; function run() {}'),
    ).toEqual([]);
    expect(inspect('function run() {} let current = null; var active = 0;')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('let/var') }),
      expect.objectContaining({ message: expect.stringContaining('let/var') }),
    ]);
  });

  it('does not treat runtime enums or namespaces as type-only declarations', () => {
    for (const prefix of ['enum Mode { Normal }', 'namespace State { export const value = 1; }']) {
      expect(inspect(`${prefix} type Options = { enabled: boolean }; const LIMIT = 64;`)).toEqual([
        expect.objectContaining({ message: expect.stringContaining('type/interface') }),
        expect.objectContaining({ message: expect.stringContaining('非函数 const') }),
      ]);
    }
  });

  it('does not inspect function-local, class-local or ambient global declaration order', () => {
    expect(
      inspect(`
        interface Options { enabled: boolean }
        const LIMIT = 64;
        declare global { interface Window { feature: boolean } }
        declare module 'library' { export interface Request { id: string } }
        function run() { const local = 1; type Local = typeof local; return local; }
        class Reader { read() { const local = 1; type Local = typeof local; return local; } }
      `),
    ).toEqual([]);
  });

  it('recognizes a TSX component arrow while leaving its local declarations alone', () => {
    expect(
      inspect(
        'interface Props { text: string } const Label = ({ text }: Props) => { const value = text; type Local = typeof value; return <span>{value}</span>; };',
        'component.tsx',
      ),
    ).toEqual([]);
    expect(inspect('const Label = () => <span />; const LIMIT = 1;', 'component.tsx')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('非函数 const') }),
    ]);
    expect(inspect('export default (() => <span />); interface Props {}', 'component.tsx')).toEqual(
      [expect.objectContaining({ message: expect.stringContaining('type/interface') })],
    );
  });

  it('reports each late declaration at its actual source location', () => {
    expect(
      inspect('function run() {}\ntype Result = number;\nconst FIRST = 1, SECOND = 2;'),
    ).toEqual([
      {
        line: 2,
        column: 1,
        message: expect.stringContaining('type/interface'),
      },
      {
        line: 3,
        column: 7,
        message: expect.stringContaining('非函数 const'),
      },
      {
        line: 3,
        column: 18,
        message: expect.stringContaining('非函数 const'),
      },
    ]);
  });
});
