import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkBoundaries } from '../../scripts/check-boundaries.mjs';

const fixtures = [];

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'my-pi-imports-'));
  fixtures.push(root);
  await Promise.all([mkdir(join(root, 'apps')), mkdir(join(root, 'packages'))]);
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

describe('workspace source imports', () => {
  it.each([
    ['static bare builtin', "import fs from 'fs';"],
    ['builtin subpath', "export { readFile } from 'fs/promises';"],
    ['node-prefixed dynamic import', "const fs = await import('node:fs');"],
    ['bare dynamic import', "const path = await import('path');"],
    ['type-only declaration', "import type { Stats } from 'fs';"],
    ['import type expression', "type Host = import('node:fs').Stats;"],
    ['typeof import expression', "type Host = typeof import('path');"],
    ['literal require', "const os = require('os');"],
    ['template require', 'const path = require(`node:path`);'],
    ['template dynamic import', 'const fs = await import(`fs`);'],
    ['import equals require', "import fs = require('fs');"],
  ])('rejects a renderer %s after parsing its source', async (_name, content) => {
    const root = await fixture({ 'apps/web/src/invalid.ts': content });

    await expect(checkBoundaries(root)).rejects.toThrow('Renderer 只能使用浏览器安全模块');
  });

  it.each([
    'electron',
    '@earendil-works/pi-ai',
    'fastify',
    '@fastify/static',
    'better-sqlite3',
    'drizzle-orm',
    '@my-pi-harness/daemon',
    '@my-pi-harness/desktop',
    '@my-pi-harness/agent-runtime',
  ])('rejects renderer backend dependency %s', async (dependency) => {
    const root = await fixture({ 'apps/web/src/invalid.ts': `import value from '${dependency}';` });

    await expect(checkBoundaries(root)).rejects.toThrow('Renderer 只能使用浏览器安全模块');
  });

  it.each(['apps/web/src/index.ts', 'apps/desktop/src/main.ts', 'apps/daemon/src/service.ts'])(
    'rejects cross-app relative imports from %s',
    async (importer) => {
      const target = importer.startsWith('apps/daemon/') ? 'desktop' : 'daemon';
      const root = await fixture({
        [importer]: `import type { Service } from '../../${target}/src/private.js';`,
      });

      await expect(checkBoundaries(root)).rejects.toThrow('应用间不能导入业务源码');
    },
  );

  it('rejects a renderer relative import of another package implementation', async () => {
    const root = await fixture({
      'apps/web/src/index.ts':
        "import { Agent } from '../../../packages/agent-runtime/src/index.js';",
    });

    await expect(checkBoundaries(root)).rejects.toThrow('跨工作区导入必须使用包名');
  });

  it.each([
    'fs',
    'node:path',
    'electron',
    'fastify',
    '@my-pi-harness/daemon',
    '@my-pi-harness/agent-runtime',
    '@earendil-works/pi-agent-core',
  ])('rejects host or business dependency %s in protocol', async (dependency) => {
    const root = await fixture({
      'packages/protocol/src/index.ts': `export * from '${dependency}';`,
    });

    await expect(checkBoundaries(root)).rejects.toThrow('公共协议不能依赖宿主或业务实现');
  });

  it('rejects protocol imports of host source by relative path', async () => {
    const root = await fixture({
      'packages/protocol/src/index.ts':
        "type Service = import('../../../apps/daemon/src/service.js').Service;",
    });

    await expect(checkBoundaries(root)).rejects.toThrow('跨工作区导入必须使用包名');
  });

  it.each([
    [
      'renderer static import',
      'apps/web/src/features/x.ts',
      'packages/agent-runtime/src/x.ts',
      (specifier) => `import { value } from '${specifier}';`,
    ],
    [
      'daemon type import',
      'apps/daemon/src/service.ts',
      'packages/protocol/src/index.ts',
      (specifier) => `import type { Value } from '${specifier}';`,
    ],
    [
      'desktop dynamic import',
      'apps/desktop/src/main.ts',
      'packages/agent-runtime/src/x.ts',
      (specifier) => `const runtime = await import('${specifier}');`,
    ],
    [
      'protocol import type expression',
      'packages/protocol/src/index.ts',
      'packages/other/src/index.ts',
      (specifier) => `type Value = import('${specifier}').Value;`,
    ],
    [
      'package re-export',
      'packages/agent-runtime/src/index.ts',
      'packages/protocol/src/index.ts',
      (specifier) => `export { value } from '${specifier}';`,
    ],
    [
      'package require',
      'packages/other/src/index.ts',
      'apps/daemon/src/service.ts',
      (specifier) => `const service = require('${specifier}');`,
    ],
  ])(
    'rejects a %s pointing to actual source in another workspace',
    async (_name, importer, target, source) => {
      const specifier = relative(dirname(importer), target)
        .replaceAll('\\', '/')
        .replace(/\.ts$/, '.js');
      const root = await fixture({
        [importer]: source(specifier),
        [target]: 'export const value = 1; export type Value = number;',
      });

      await expect(checkBoundaries(root)).rejects.toThrow('跨工作区导入必须使用包名');
    },
  );

  it('allows relative modules owned by the same app or package and source paths used as URLs', async () => {
    const root = await fixture({
      'apps/daemon/src/features/run.ts': "import { value } from '../local.js';",
      'apps/daemon/src/local.ts': 'export const value = 1;',
      'packages/other/src/features/run.ts': "const local = await import('../local.js');",
      'packages/other/src/local.ts': 'export const value = 1;',
      'apps/web/vite.config.ts':
        "const alias = new URL('../../packages/protocol/src/index.ts', import.meta.url);",
    });

    await expect(checkBoundaries(root)).resolves.toBe(5);
  });

  it('rejects runtime business imported by desktop through a package name', async () => {
    const root = await fixture({
      'apps/desktop/src/main.ts': "const runtime = await import('@my-pi-harness/agent-runtime');",
    });

    await expect(checkBoundaries(root)).rejects.toThrow('桌面主进程不能导入 Runtime 业务');
  });

  it('rejects imports that bypass the protocol public export', async () => {
    const root = await fixture({
      'apps/web/src/index.ts': "import { Schema } from '@my-pi-harness/protocol/src/index.js';",
    });

    await expect(checkBoundaries(root)).rejects.toThrow('公共协议必须从显式 exports 导入');
  });

  it('allows browser-safe protocol and schema libraries without treating strings as imports', async () => {
    const root = await fixture({
      'apps/web/src/index.ts': [
        "import type { HealthResponse } from '@my-pi-harness/protocol';",
        "import { Value } from 'typebox/value';",
        "type Schema = import('typebox').TSchema;",
        "export { Ready } from './ready.js';",
        "const example = `import('node:fs')`;",
      ].join('\n'),
      'apps/web/src/ready.ts': "export const Ready = 'ready';",
      'packages/protocol/src/index.ts':
        "import { Type } from 'typebox'; export { VERSION } from './version.js';",
      'packages/protocol/src/version.ts': 'export const VERSION = 1;',
      'apps/daemon/src/service.ts':
        "import { readFile } from 'node:fs/promises'; import Fastify from 'fastify';",
      'apps/desktop/src/main.ts': "import { app } from 'electron'; import { join } from 'path';",
      'apps/web/vite.config.ts': "import { fileURLToPath } from 'node:url';",
    });

    await expect(checkBoundaries(root)).resolves.toBe(7);
  });

  it('reports every invalid source while ignoring generated output and dependencies', async () => {
    const root = await fixture({
      'apps/web/src/first.ts': "import fs from 'fs';",
      'packages/protocol/src/second.ts': "import host from 'node:os';",
      'apps/web/dist/generated.ts': "import host from 'node:fs';",
      'packages/protocol/node_modules/third-party/index.ts': "import host from 'fs';",
    });

    await expect(checkBoundaries(root)).rejects.toThrow(
      /apps\/web\/src\/first\.ts[\s\S]*packages\/protocol\/src\/second\.ts/,
    );
  });
});

describe('MCP integration ownership', () => {
  it.each([
    '@my-pi-harness/storage',
    '@my-pi-harness/agent-runtime',
    '@my-pi-harness/daemon',
    'fastify',
    'react',
    'better-sqlite3',
  ])('rejects %s from the integration implementation', async (dependency) => {
    const root = await fixture({
      'packages/integrations/src/adapter.ts': `import value from '${dependency}';`,
    });
    await expect(checkBoundaries(root)).rejects.toThrow(
      'Integrations 不能拥有数据库、Runtime、HTTP 或 Renderer',
    );
  });
  it('allows the public SDK, execution, schema and Node adapters', async () => {
    const root = await fixture({
      'packages/integrations/src/adapter.ts':
        "import { Client } from '@modelcontextprotocol/client'; import { startPersistentProcess } from '@my-pi-harness/execution'; import { Type } from 'typebox'; import { Buffer } from 'node:buffer';",
    });
    await expect(checkBoundaries(root)).resolves.toBe(1);
  });
});
