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
      'apps/desktop/electron-builder.config.cjs': "const pkg = require('../../package.json');",
      'apps/daemon/vitest.built.config.ts': 'export default {};',
      'eslint.config.js': 'export default [];',
      'apps/daemon/test/run-state.test.ts': 'export const value = 1;',
      'tests/e2e/runtime.spec.ts': 'export const value = 1;',
      'packages/protocol/src/index.ts': "export { VERSION } from './version.js';",
    });

    await expect(checkSourceConventions(root)).resolves.toBe(7);
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
      'apps/web/src/main.tsx': "import { App } from './app/index.js'; import './styles/index.css';",
      'apps/web/src/app/index.tsx': 'export const App = () => <main />;',
      'apps/web/src/components/ui/card/index.tsx':
        "export { CardTitle } from './card-title/index.js';",
      'apps/web/src/components/ui/card/card-title/index.tsx':
        'export const CardTitle = () => <h2>状态</h2>;',
    });

    await expect(checkSourceConventions(root)).resolves.toBe(4);
  });

  it('rejects a module import that follows a style import', async () => {
    const root = await fixture({
      'apps/web/src/app/index.tsx': "import './index.scss'; import type { FC } from 'react';",
    });

    await expect(checkSourceConventions(root)).rejects.toThrow(
      'Web 样式 import 必须置于其他 import 之后',
    );
  });

  it('allows style imports at the end of the import group', async () => {
    const root = await fixture({
      'apps/web/src/app/index.tsx':
        "import type { FC } from 'react'; import './index.css'; import './index.scss'; export const value = 1;",
    });

    await expect(checkSourceConventions(root)).resolves.toBe(1);
  });

  it.each(['config', 'services', 'stores', 'constants', 'hooks', 'utils'])(
    'rejects an index re-export from Web %s',
    async (directory) => {
      const root = await fixture({
        [`apps/web/src/features/runtime/${directory}/index.ts`]: "export * from './owned.js';",
      });

      await expect(checkSourceConventions(root)).rejects.toThrow('禁止 index 聚合导出');
    },
  );

  it('rejects an imported binding exported again by a helper index', async () => {
    const root = await fixture({
      'apps/web/src/hooks/index.ts':
        "import { useTheme } from './use-theme.js'; export { useTheme };",
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
    "export { value } from './value.ts';",
    "const module = await import('./value');",
    'const module = await import(`./value.ts`);',
    "type Module = import('./value').Module;",
  ])('rejects extensionless or source-extension ESM: %s', async (content) => {
    const root = await fixture({ 'apps/daemon/src/index.ts': content });
    await expect(checkSourceConventions(root)).rejects.toThrow('相对 ESM import 必须写 .js 扩展');
  });

  it('allows explicit compiled modules, native scripts, JSON, styles and URL source paths', async () => {
    const root = await fixture({
      'apps/daemon/src/index.ts': [
        "import { value } from './value.js';",
        "export { value as native } from './native.mjs';",
        "type Module = import('./value.js').Module;",
        "const native = await import('./native.cjs');",
        "import schema from './schema.json' with { type: 'json' };",
        "const source = new URL('./bootstrap.ts', import.meta.url);",
      ].join('\n'),
      'apps/web/src/app/index.tsx': "import './index.css?inline'; import './index.scss';",
      'scripts/dev.mjs': "import { ensureNode } from './node-runtime.mjs';",
    });

    await expect(checkSourceConventions(root)).resolves.toBe(3);
  });
});
