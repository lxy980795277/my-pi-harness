import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkSourceConventions } from '../../scripts/check-source-conventions.mjs';

const fixtures = [];

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'my-pi-source-conventions-'));
  fixtures.push(root);
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('source file conventions', () => {
  it('accepts grouped module types, constants, state and implementations', async () => {
    const root = await fixture({
      'apps/daemon/src/service.ts': [
        'type Result = typeof defaults;',
        'interface Options { enabled: boolean }',
        'const defaults = { enabled: true };',
        'let current = defaults;',
        'const read = (): Result => current;',
        'function reset() { current = defaults; }',
        'reset();',
      ].join('\n'),
    });
    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it.each([
    ['const enabled = true;\ninterface Options {}', '模块级 type/interface 必须集中'],
    ['function read() {}\nconst enabled = true;', '模块级非函数 const 必须集中'],
    ['let current = true;\nconst enabled = true;', '模块级非函数 const 必须集中'],
    ['function read() {}\nlet current = true;', '模块级 let/var 状态必须集中'],
  ])('rejects interleaved module declarations: %s', async (content, message) => {
    const root = await fixture({ 'packages/tools/src/service.ts': content });
    await expect(checkSourceConventions(root)).rejects.toThrow(message);
  });

  it('keeps local declarations scoped and does not impose production layout on test fixtures', async () => {
    const content = [
      'function read() { const value = 1; type Value = typeof value; return value; }',
      'const example = 1;',
      'type Example = typeof example;',
    ].join('\n');
    const root = await fixture({ 'packages/tools/test/service.test.ts': content });
    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it.each(['BadName.ts', 'bad_name.ts', 'mixedCase.config.js'])(
    'rejects non-kebab source filename %s',
    async (name) => {
      const root = await fixture({ [`apps/daemon/src/${name}`]: 'export const value = 1;' });
      await expect(checkSourceConventions(root)).rejects.toThrow('源文件名必须使用 kebab-case');
    },
  );

  it('permits framework configs, test suffixes and a package public entry', async () => {
    const root = await fixture({
      'apps/desktop/electron.vite.config.ts':
        "const entry = new URL('./src/main/index.ts', import.meta.url);",
      'apps/desktop/src/main/index.ts': 'export const ready = true;',
      'apps/desktop/electron-builder.config.cjs': "const pkg = require('../../package.json');",
      'package.json': '{}',
      'apps/daemon/vitest.deployment.config.ts': 'export default {};',
      'eslint.config.js': 'export default [];',
      'apps/daemon/test/run-state.test.ts': 'export const value = 1;',
      'tests/e2e/runtime.spec.ts': 'export const value = 1;',
      'packages/protocol/src/index.ts': "export { VERSION } from './version';",
      'packages/protocol/src/version.ts': 'export const VERSION = 1;',
    });

    await expect(checkSourceConventions(root)).resolves.toBe(8);
  });

  it.each([
    'apps/web/src/features/workspaces/types/workspace-view.ts',
    'apps/web/src/types/work/question-view.ts',
    'packages/agent-runtime/src/types/context-view.ts',
  ])('rejects redundant view suffixes in type modules at %s', async (path) => {
    const root = await fixture({ [path]: 'export type Workspace = { id: string };' });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      'types 文件使用领域名，不添加冗余 -view 后缀',
    );
  });

  it('allows domain type names and view helpers outside type directories', async () => {
    const root = await fixture({
      'apps/web/src/features/workspaces/types/workspace.ts':
        'export type Workspace = { id: string };',
      'apps/web/src/features/work/utils/work-view.ts': 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(2);
  });

  it('allows 1000 physical lines with a final newline', async () => {
    const root = await fixture({ 'apps/daemon/src/service.ts': '// line\n'.repeat(1_000) });
    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it('rejects a source file with more than 1000 physical lines', async () => {
    const root = await fixture({ 'apps/daemon/src/service.ts': '// line\r\n'.repeat(1_001) });
    await expect(checkSourceConventions(root)).rejects.toThrow('源码文件超过 1000 行');
  });

  it('skips build outputs and the explicitly owned generated version source', async () => {
    const root = await fixture({
      'apps/web/src/main.tsx': 'export const value = 1;',
      'apps/web/dist/BadGeneratedName.tsx': '// generated\n'.repeat(1_001),
      'out/daemon/BadName.ts': "import './source.ts';",
      'packages/protocol/src/version.ts': '// generated version\n'.repeat(1_001),
      'apps/web/node_modules/library/index.ts': "import './source';",
    });

    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it('rejects flat hand-written UI components without exempting the entire primitives directory', async () => {
    const root = await fixture({
      'apps/web/src/components/ui/button.tsx': 'export const Button = () => <button>继续</button>;',
    });

    await expect(checkSourceConventions(root)).rejects.toThrow(
      'Web 组件必须使用独立目录中的 index.tsx',
    );
  });

  it('allows component-family exports, independent component directories and main.tsx', async () => {
    const root = await fixture({
      'apps/web/src/main.tsx': "import { App } from './app'; import './styles/index.css';",
      'apps/web/src/app/index.tsx': 'export const App = () => <main />;',
      'apps/web/src/components/ui/card/index.tsx': "export { CardTitle } from './card-title';",
      'apps/web/src/components/ui/card/card-title/index.tsx':
        'export const CardTitle = () => <h2>状态</h2>;',
    });

    await expect(checkSourceConventions(root)).resolves.toBe(4);
  });

  it('rejects a module import that follows a style import', async () => {
    const root = await fixture({
      'apps/web/src/app/index.tsx': "import './index.scss'; import type { FC } from 'react';",
      'apps/web/src/app/index.scss': 'main {}',
    });

    await expect(checkSourceConventions(root)).rejects.toThrow(
      'Web 样式 import 必须置于其他 import 之后',
    );
  });

  it('allows style imports at the end of the import group', async () => {
    const root = await fixture({
      'apps/web/src/app/index.tsx':
        "import type { FC } from 'react'; import './index.css'; import './index.scss'; export const value = 1;",
      'apps/web/src/app/index.css': 'main {}',
      'apps/web/src/app/index.scss': 'main {}',
    });

    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it.each(['config', 'services', 'stores', 'constants', 'hooks', 'utils'])(
    'rejects an index re-export from Web %s',
    async (directory) => {
      const root = await fixture({
        [`apps/web/src/features/runtime/${directory}/index.ts`]: "export * from './owned';",
        [`apps/web/src/features/runtime/${directory}/owned.ts`]: 'export const value = 1;',
      });

      await expect(checkSourceConventions(root)).rejects.toThrow('禁止 index 聚合导出');
    },
  );

  it('rejects an imported binding exported again by a helper index', async () => {
    const root = await fixture({
      'apps/web/src/hooks/index.ts': "import { useTheme } from './use-theme'; export { useTheme };",
      'apps/web/src/hooks/use-theme.ts': 'export const useTheme = () => {};',
    });

    await expect(checkSourceConventions(root)).rejects.toThrow('禁止 index 聚合导出');
  });

  it('permits a helper index that owns its implementation instead of aggregating exports', async () => {
    const root = await fixture({
      'apps/web/src/utils/index.ts': 'const value = 1; export { value };',
    });

    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it.each([
    "import { value } from './value';",
    "import type { Module } from './value';",
    "export { value } from './value';",
    "export * from './value';",
    "const module = await import('./value');",
    'const module = await import(`./value`);',
    "type Module = import('./value').Module;",
  ])('allows extensionless TypeScript module syntax: %s', async (content) => {
    const root = await fixture({
      'apps/daemon/src/index.ts': content,
      'apps/daemon/src/value.ts': 'export interface Module {}\nexport const value = 1;',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(2);
  });

  it.each([
    "import { value } from './value.js';",
    "import type { Module } from './value.js';",
    "export { value } from './value.ts';",
    "export * from './value.js';",
    "const module = await import('./value.js');",
    'const module = await import(`./value.ts`);',
    "type Module = import('./value.js').Module;",
  ])('rejects TypeScript source and compiled extensions: %s', async (content) => {
    const root = await fixture({
      'apps/daemon/src/index.ts': content,
      'apps/daemon/src/value.ts': 'export interface Module {}\nexport const value = 1;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      'TypeScript 模块 import 不写源码或编译扩展',
    );
  });

  it.each(['./value.js', './value.jsx', './value.tsx'])(
    'rejects %s for an existing TSX module',
    async (specifier) => {
      const root = await fixture({
        'packages/tools/src/index.ts': `export { value } from '${specifier}';`,
        'packages/tools/src/value.tsx': 'export const value = 1;',
      });
      await expect(checkSourceConventions(root)).rejects.toThrow(
        'TypeScript 模块 import 不写源码或编译扩展',
      );
    },
  );

  it('rejects the compiled suffix when TypeScript and JavaScript share a stem', async () => {
    const root = await fixture({
      'packages/tools/src/index.ts': "import { value } from './value.js';",
      'packages/tools/src/value.ts': 'export const value = 1;',
      'packages/tools/src/value.js': 'export const value = 2;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      'TypeScript 模块 import 不写源码或编译扩展',
    );
  });

  it('allows real JavaScript modules, native scripts, resources and URL source paths', async () => {
    const root = await fixture({
      'apps/daemon/src/index.ts': [
        "import { value } from './value.js';",
        "export { value as native } from './native.mjs';",
        "type Module = import('./value.js').Module;",
        "const native = await import('./native.cjs');",
        "const typed = await import('./native.mts');",
        "const common = await import('./native.cts');",
        "import schema from './schema.json' with { type: 'json' };",
        "const source = new URL('./bootstrap.ts', import.meta.url);",
      ].join('\n'),
      'apps/daemon/src/value.js': 'export const value = 1;',
      'apps/daemon/src/native.mjs': 'export const value = 1;',
      'apps/daemon/src/native.cjs': 'module.exports = { value: 1 };',
      'apps/daemon/src/native.mts': 'export const value = 1;',
      'apps/daemon/src/native.cts': 'export const value = 1;',
      'apps/daemon/src/schema.json': '{}',
      'apps/daemon/src/bootstrap.ts': 'export const ready = true;',
      'apps/web/src/app/index.tsx': "import './index.css?inline'; import './index.scss';",
      'apps/web/src/app/index.css': 'main {}',
      'apps/web/src/app/index.scss': 'main {}',
      'scripts/dev.mjs': "import { ensureNode } from './node-runtime.mjs';",
      'scripts/node-runtime.mjs': 'export const ensureNode = () => {};',
    });

    await expect(checkSourceConventions(root)).resolves.toBe(10);
  });

  it.each(['js', 'mjs', 'cjs'])(
    'requires the actual %s extension for a JavaScript module',
    async (extension) => {
      const root = await fixture({
        'packages/tools/src/index.ts': "export { value } from './native';",
        [`packages/tools/src/native.${extension}`]: 'const value = 1;',
      });
      await expect(checkSourceConventions(root)).rejects.toThrow(
        '真实 JavaScript 模块 import 必须保留实际扩展',
      );
    },
  );

  it('resolves a JavaScript file before a TypeScript directory index', async () => {
    const root = await fixture({
      'packages/tools/src/index.ts': "export { value } from './native';",
      'packages/tools/src/native.js': 'export const value = 1;',
      'packages/tools/src/native/index.ts': 'export const value = 2;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      '真实 JavaScript 模块 import 必须保留实际扩展',
    );
  });

  it('allows an extensionless TypeScript directory index', async () => {
    const root = await fixture({
      'packages/tools/src/index.ts': "export { value } from './native';",
      'packages/tools/src/native/index.ts': 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(2);
  });

  it.each(['js', 'mjs', 'cjs'])(
    'requires explicit ESM extensions in a plain Node %s script',
    async (extension) => {
      const root = await fixture({
        [`scripts/entry.${extension}`]: "const native = await import('./native');",
        'scripts/native.mjs': 'export const value = 1;',
      });
      await expect(checkSourceConventions(root)).rejects.toThrow(
        '原生 Node ESM 相对 import 必须保留实际文件扩展',
      );
    },
  );

  it.each([
    "import { value } from './native';",
    "export { value } from './native';",
    'const native = await import(`./native`);',
  ])('checks every plain Node ESM syntax: %s', async (content) => {
    const root = await fixture({
      'scripts/entry.mjs': content,
      'scripts/native.mjs': 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      '原生 Node ESM 相对 import 必须保留实际文件扩展',
    );
  });

  it('does not apply the tsx launcher rule to a similarly named plain Node script', async () => {
    const root = await fixture({
      'scripts/start-daemon.mjs': "import { value } from './owned';",
      'scripts/owned.ts': 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      '原生 Node ESM 相对 import 必须保留实际文件扩展',
    );
  });

  it('preserves real JavaScript extensions and require calls in plain Node scripts', async () => {
    const root = await fixture({
      'scripts/entry.mjs': [
        "import { value } from './native.js';",
        "export * from './native.mjs';",
        "const required = require('./native');",
        "const worker = `const worker = require('./native'); import('./owned.js')`;",
      ].join('\n'),
      'scripts/native.ts': 'export const value = 1;',
      'scripts/native.js': 'export const value = 2;',
      'scripts/native.mjs': 'export const native = 3;',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(4);
  });

  it.each([
    'scripts/smoke-desktop.mjs',
    'tests/e2e/start-daemon.mjs',
    'tests/e2e/plugin-mcp-upstream.mjs',
    'apps/daemon/test/support/tools-resources-probe.mjs',
  ])('allows extensionless TypeScript only through the declared tsx entry %s', async (entry) => {
    const root = await fixture({
      [entry]: "import { value } from './owned';",
      [join(dirname(entry), 'owned.ts')]: 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(2);

    const invalid = await fixture({
      [entry]: "import { value } from './owned.js';",
      [join(dirname(entry), 'owned.ts')]: 'export const value = 1;',
      [join(dirname(entry), 'owned.js')]: 'export const value = 2;',
    });
    await expect(checkSourceConventions(invalid)).rejects.toThrow(
      'TypeScript 模块 import 不写源码或编译扩展',
    );
  });

  it('preserves real source-resource extensions, URL entries and embedded code', async () => {
    const root = await fixture({
      'apps/daemon/src/index.ts': [
        "import raw from './owned.ts?raw';",
        "import url from './owned.ts?url';",
        "const source = new URL('./owned.ts', import.meta.url);",
        "const worker = `require('./owned'); import('./owned.js')`;",
      ].join('\n'),
      'apps/daemon/src/owned.ts': 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(2);
  });

  it.each([
    "import { Button } from '@/components/ui/button/index.js';",
    "export { Button } from './button/index.tsx';",
    "type State = import('./state.js').State;",
    "const module = await import('@/utils/owned.ts');",
  ])('rejects Web module extensions: %s', async (content) => {
    const root = await fixture({
      'apps/web/src/app/index.tsx': content,
      'apps/web/src/components/ui/button/index.tsx': 'export const Button = () => null;',
      'apps/web/src/app/button/index.tsx': 'export const Button = () => null;',
      'apps/web/src/app/state.ts': 'export interface State {}',
      'apps/web/src/utils/owned.ts': 'export const value = 1;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow(
      'TypeScript 模块 import 不写源码或编译扩展',
    );
  });

  it('allows Bundler module imports while preserving resource extensions', async () => {
    const root = await fixture({
      'apps/web/src/app/index.tsx': [
        "import { Button } from '@/components/ui/button';",
        "import { State } from './state';",
        "import icon from '@lobehub/icons-static-svg/icons/openai.svg?url';",
        "import ownIcon from '@/assets/provider.svg';",
        "import data from './data.json';",
        "import './index.css';",
      ].join('\n'),
      'apps/web/src/components/ui/button/index.tsx': 'export const Button = () => null;',
      'apps/web/src/app/state.ts': 'export interface State {}',
      'apps/web/src/assets/provider.svg': '<svg />',
      'apps/web/src/app/data.json': '{}',
      'apps/web/src/app/index.css': 'main {}',
    });
    await expect(checkSourceConventions(root)).resolves.toBe(3);
  });

  it('uses extensionless imports for the independent Web test program', async () => {
    const valid = await fixture({
      'apps/web/test/owned.test.ts': "import { owned } from '../src/utils/owned';",
      'apps/web/src/utils/owned.ts': 'export const owned = 1;',
    });
    await expect(checkSourceConventions(valid)).resolves.toBe(2);
    const invalid = await fixture({
      'apps/web/test/owned.test.ts': "import { owned } from '../src/utils/owned.js';",
      'apps/web/src/utils/owned.ts': 'export const owned = 1;',
    });
    await expect(checkSourceConventions(invalid)).rejects.toThrow(
      'TypeScript 模块 import 不写源码或编译扩展',
    );
  });

  it.each([
    '// eslint-disable-next-line @typescript-eslint/no-floating-promises\nsave();',
    '/* eslint-disable @typescript-eslint/no-floating-promises */\nsave();',
    '// eslint-disable-next-line no-restricted-syntax\nvoid save();',
  ])('rejects business lint suppression', async (content) => {
    const root = await fixture({ 'apps/web/src/features/auth/hooks/use-login.ts': content });
    await expect(checkSourceConventions(root)).rejects.toThrow('Web 禁止局部关闭 ESLint');
  });

  const waiver =
    '// eslint-disable-next-line @typescript-eslint/no-floating-promises -- execute handles failures and cancellation.';
  it('allows only the documented async event launch waiver', async () => {
    const root = await fixture({
      'apps/web/src/hooks/use-async-event.ts': `${waiver}\nexecute(...arguments_);\n`,
    });
    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it.each([
    `${waiver}\nother();\n`,
    `${waiver}\nexecute(...arguments_);\n${waiver}\nexecute(...arguments_);\n`,
    '// eslint-disable-next-line @typescript-eslint/no-floating-promises\nexecute(...arguments_);\n',
  ])('rejects expanded or unexplained async bridge waivers', async (content) => {
    const root = await fixture({ 'apps/web/src/hooks/use-async-event.ts': content });
    await expect(checkSourceConventions(root)).rejects.toThrow('Web 禁止局部关闭 ESLint');
  });

  it.each([
    ['quoted string', 'export const example = "eslint-disable-next-line";'],
    ['template tail', 'export const example = `text ${1} // eslint-disable-next-line`;'],
    ['JSX text', 'export const example = <span>// eslint-disable-next-line</span>;'],
  ])('does not interpret %s as a lint directive', async (_name, content) => {
    const root = await fixture({
      'apps/web/src/components/example/index.tsx': content,
    });
    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it('rejects a real lint directive inside a template expression', async () => {
    const root = await fixture({
      'apps/web/src/utils/describe.ts':
        'const value = `text ${\n// eslint-disable-next-line no-restricted-syntax\noperation()\n}`;',
    });
    await expect(checkSourceConventions(root)).rejects.toThrow('Web 禁止局部关闭 ESLint');
  });
});
