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

  it('allows host consumers to use the declared internal protocol entry', async () => {
    const root = await fixture({
      'apps/daemon/src/service.ts':
        "import type { EventInput } from '@my-pi-harness/protocol/internal';",
      'packages/agent-runtime/src/ports.ts':
        "export type { RequestAcceptance } from '@my-pi-harness/protocol/internal';",
      'packages/storage/src/session.ts':
        "import { FrozenSkillSchema } from '@my-pi-harness/protocol/internal';",
      'packages/protocol/src/internal/skills.ts':
        "import { SkillSelectionSchema } from '../extensions/skills'; import { Type } from 'typebox';",
    });

    await expect(checkBoundaries(root)).resolves.toBe(4);
  });

  it.each([
    "import type { FrozenSkill } from '@my-pi-harness/protocol/internal';",
    "const host = await import('@my-pi-harness/protocol/internal');",
  ])('rejects renderer access to internal protocol: %s', async (content) => {
    const root = await fixture({ 'apps/web/src/invalid.ts': content });

    await expect(checkBoundaries(root)).rejects.toThrow('Renderer不能导入宿主内部协议');
  });

  it.each(['@my-pi-harness/protocol/unknown', '@my-pi-harness/protocol/internal/skills'])(
    'rejects undeclared protocol entry %s from a host consumer',
    async (specifier) => {
      const root = await fixture({
        'apps/daemon/src/service.ts': `import type { Value } from '${specifier}';`,
      });

      await expect(checkBoundaries(root)).rejects.toThrow('公共协议必须从显式 exports 导入');
    },
  );

  it.each([
    ['packages/protocol/src/index.ts', "export * from './internal';"],
    [
      'packages/protocol/src/extensions/skills.ts',
      "import type { FrozenSkill } from '../internal/skills';",
    ],
  ])('rejects internal data referenced by the public module %s', async (path, content) => {
    const root = await fixture({ [path]: content });

    await expect(checkBoundaries(root)).rejects.toThrow('公开协议不能依赖宿主内部数据');
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
    '@my-pi-harness/tools',
    '@my-pi-harness/tools/skills',
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
      'Integrations 不能拥有工具、数据库、Runtime、HTTP 或 Renderer',
    );
  });
  it('allows the public SDK, sandbox, schema and Node adapters', async () => {
    const root = await fixture({
      'packages/integrations/src/adapter.ts':
        "import { Client } from '@modelcontextprotocol/client'; import { startProcess } from '@my-pi-harness/sandbox/process'; import { Type } from 'typebox'; import { Buffer } from 'node:buffer';",
    });
    await expect(checkBoundaries(root)).resolves.toBe(1);
  });

  it.each(['@my-pi-harness/plugins', '@my-pi-harness/plugins/auth'])(
    'rejects an integration adapter importing plugin implementation %s',
    async (dependency) => {
      const root = await fixture({
        'packages/integrations/src/oauth.ts': `import type { Plugin } from '${dependency}';`,
      });

      await expect(checkBoundaries(root)).rejects.toThrow('Integrations不能反向依赖Plugins');
    },
  );
});

describe('plugin domain ownership', () => {
  it.each([
    '@my-pi-harness/storage',
    '@my-pi-harness/storage/credentials',
    '@my-pi-harness/agent-runtime',
    '@my-pi-harness/daemon',
    '@my-pi-harness/desktop',
    '@my-pi-harness/web',
    '@earendil-works/pi-agent-core',
    'fastify',
    'fastify/types',
    '@fastify/static',
    'better-sqlite3',
    'drizzle-orm/better-sqlite3',
    'react',
    'react/jsx-runtime',
    'react-dom/client',
    'electron',
  ])('rejects host implementation %s from plugins', async (dependency) => {
    const root = await fixture({
      'packages/plugins/src/service.ts': `import type { Host } from '${dependency}';`,
    });

    await expect(checkBoundaries(root)).rejects.toThrow(
      'Plugins只能通过窄端口访问持久化、Runtime、HTTP或Renderer',
    );
  });

  it('allows plugin services to use declared domain ports, Skills and integration mechanisms', async () => {
    const root = await fixture({
      'packages/plugins/src/service.ts': [
        "import type { PluginInstallation } from '@my-pi-harness/protocol/internal';",
        "import type { PluginView } from '@my-pi-harness/protocol';",
        "import { SkillCatalog } from '@my-pi-harness/tools/skills';",
        "import { beginOAuth } from '@my-pi-harness/integrations';",
        "import { isPublicAddress } from '@my-pi-harness/sandbox';",
        "import { readFile } from 'node:fs/promises';",
        "import type { PluginRepository } from './ports';",
      ].join('\n'),
      'packages/plugins/src/ports.ts': 'export interface PluginRepository {}',
    });

    await expect(checkBoundaries(root)).resolves.toBe(2);
  });
});

describe('tool and sandbox ownership', () => {
  it.each([
    '@my-pi-harness/agent-runtime',
    '@my-pi-harness/agent-runtime/tools',
    '@my-pi-harness/storage',
    '@my-pi-harness/integrations',
    '@my-pi-harness/plugins',
    '@my-pi-harness/plugins/auth',
    '@my-pi-harness/daemon',
  ])('rejects host implementation %s from tools', async (dependency) => {
    const root = await fixture({
      'packages/tools/src/registration.ts': `import type { Host } from '${dependency}';`,
    });
    await expect(checkBoundaries(root)).rejects.toThrow('Tools只能通过窄端口访问宿主领域');
  });

  it.each([
    '@my-pi-harness/tools',
    '@my-pi-harness/tools/document-text',
    '@my-pi-harness/integrations',
    '@my-pi-harness/agent-runtime',
    '@my-pi-harness/protocol',
    '@my-pi-harness/storage',
    '@my-pi-harness/daemon',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
  ])('rejects business or Agent dependency %s from sandbox', async (dependency) => {
    const root = await fixture({
      'packages/sandbox/src/process.ts': `const implementation = await import('${dependency}');`,
    });
    await expect(checkBoundaries(root)).rejects.toThrow('Sandbox不能依赖业务或Agent包');
  });

  it('allows tools to use explicit sandbox leaves, protocol DTOs and their own modules', async () => {
    const root = await fixture({
      'packages/tools/src/registration.ts': [
        "import { startProcess } from '@my-pi-harness/sandbox/process';",
        "import { workspacePath } from '@my-pi-harness/sandbox/filesystem';",
        "import { isPublicAddress } from '@my-pi-harness/sandbox/network';",
        "import type { ToolDefinition } from '@my-pi-harness/protocol';",
        "import { Type } from 'typebox';",
        "export { registration } from './local.js';",
      ].join('\n'),
      'packages/tools/src/local.ts': 'export const registration = {};',
    });
    await expect(checkBoundaries(root)).resolves.toBe(2);
  });

  it('allows sandbox to use Node primitives and its own modules', async () => {
    const root = await fixture({
      'packages/sandbox/src/process.ts': [
        "import { spawn } from 'node:child_process';",
        "import type { FileHandle } from 'node:fs/promises';",
        "export { stop } from './cleanup.js';",
      ].join('\n'),
      'packages/sandbox/src/cleanup.ts': 'export function stop() {}',
    });
    await expect(checkBoundaries(root)).resolves.toBe(2);
  });
});
