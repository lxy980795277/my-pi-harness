import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  'output',
  '.cache',
  '.turbo',
  'coverage',
  'playwright-report',
  'test-results',
]);

async function sourceFiles(directory, recursive = true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (ignoredDirectories.has(entry.name)) return [];
      const path = join(directory, entry.name);
      if (recursive && entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && sourceExtensions.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

function severity(rule) {
  return Array.isArray(rule) ? rule[0] : rule;
}

function expectTypedConfig(config, path) {
  expect(config.languageOptions.parser.meta.name, path).toMatch(/typescript-eslint\/parser/);
  expect(config.languageOptions.parserOptions.project, path).toBeInstanceOf(Array);
  expect(config.languageOptions.parserOptions.project.length, path).toBeGreaterThan(0);
  expect(config.languageOptions.parserOptions.tsconfigRootDir, path).toBe(root);
  expect(severity(config.rules['@typescript-eslint/no-floating-promises']), path).toBe(2);
  expect(severity(config.rules['@typescript-eslint/no-misused-promises']), path).toBe(2);
}

describe('real ESLint configuration coverage', () => {
  it('applies an executable configuration to every repository source file', async () => {
    const eslint = new ESLint({ cwd: root });
    const directories = ['apps', 'packages', 'scripts', 'tests'];
    const groups = await Promise.all([
      sourceFiles(root, false),
      ...directories.map((directory) => sourceFiles(join(root, directory))),
    ]);
    for (const files of groups) expect(files.length).toBeGreaterThan(0);

    for (const file of groups.flat()) {
      const path = relative(root, file).replaceAll('\\', '/');
      expect(await eslint.isPathIgnored(file), path).toBe(false);
      const config = await eslint.calculateConfigForFile(file);
      expect(config, path).toBeDefined();
      if (/\.[cm]?tsx?$/.test(file)) {
        expectTypedConfig(config, path);
      } else {
        expect(severity(config.rules['no-undef']), path).toBe(2);
        expect(severity(config.rules['no-unused-vars']), path).toBe(2);
      }
    }
  });

  it.each([
    'vitest.config.ts',
    'playwright.config.ts',
    'apps/web/vite.config.ts',
    'apps/web/test/projection.test.ts',
    'apps/desktop/electron.vite.config.ts',
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/preload/index.ts',
    'apps/daemon/src/bootstrap.ts',
    'packages/protocol/src/index.ts',
    'tests/e2e/runtime.spec.ts',
    'scripts/lint-extension-probe.cts',
    'scripts/lint-extension-probe.mts',
  ])('keeps typed parser and rules enabled for %s', async (path) => {
    const eslint = new ESLint({ cwd: root });
    const file = join(root, path);
    expect(await eslint.isPathIgnored(file)).toBe(false);
    const config = await eslint.calculateConfigForFile(file);
    expect(config).toBeDefined();
    expectTypedConfig(config, path);
  });

  it.each([
    'eslint.config.js',
    'packages/eslint-config/index.js',
    'scripts/dev.mjs',
    'tests/unit/lint-coverage.test.js',
    'apps/desktop/electron-builder.config.cjs',
  ])('keeps recommended JavaScript rules enabled for %s', async (path) => {
    const eslint = new ESLint({ cwd: root });
    const file = join(root, path);
    expect(await eslint.isPathIgnored(file)).toBe(false);
    const config = await eslint.calculateConfigForFile(file);
    expect(config).toBeDefined();
    expect(severity(config.rules['no-undef'])).toBe(2);
    expect(severity(config.rules['no-unused-vars'])).toBe(2);
  });

  it.each([
    'apps/web/src/app/index.tsx',
    'apps/web/src/features/runtime/components/runtime-page/index.tsx',
    'apps/web/src/features/runtime/hooks/use-runtime-connection.ts',
  ])('applies Hook and project Renderer rules to %s', async (path) => {
    const eslint = new ESLint({ cwd: root });
    const config = await eslint.calculateConfigForFile(join(root, path));
    expect(config).toBeDefined();
    for (const rule of [
      'react-hooks/rules-of-hooks',
      'react-hooks/exhaustive-deps',
      'project-react/component-declaration',
      'project-react/zustand-selector',
      'project-react/transport-owner',
      'project-react/presentation-only',
    ]) {
      expect(severity(config.rules[rule]), `${path}: ${rule}`).toBe(2);
    }
  });

  it('includes the independent Bundler test program', async () => {
    const eslint = new ESLint({ cwd: root });
    const config = await eslint.calculateConfigForFile(
      join(root, 'apps/web/test/projection.test.ts'),
    );
    expect(config.languageOptions.parserOptions.project).toContain('./apps/web/tsconfig.test.json');
  });

  it('includes the browser-aware E2E program without relaxing typed rules', async () => {
    const eslint = new ESLint({ cwd: root });
    const file = join(root, 'tests/e2e/settings.spec.ts');
    const config = await eslint.calculateConfigForFile(file);
    expectTypedConfig(config, file);
    expect(config.languageOptions.parserOptions.project).toContain('./tests/e2e/tsconfig.json');
    expect(config.languageOptions.parserOptions.project).toContain('./apps/web/tsconfig.test.json');
  });

  it('resolves DOM values through the E2E program instead of the Node program', async () => {
    const eslint = new ESLint({ cwd: root });
    const results = await eslint.lintText(
      'export const readTitle = (): string => document.title;',
      {
        filePath: join(root, 'tests/e2e/settings.spec.ts'),
      },
    );
    expect(results[0].messages).toEqual([]);
    const rejected = await eslint.lintText(
      'export const launch = (): void => { Promise.resolve(); };',
      {
        filePath: join(root, 'tests/e2e/settings.spec.ts'),
      },
    );
    expect(rejected[0].messages).toContainEqual(
      expect.objectContaining({ ruleId: '@typescript-eslint/no-floating-promises', severity: 2 }),
    );
  });

  it('resolves Renderer imports through the independent Bundler test program', async () => {
    const eslint = new ESLint({ cwd: root });
    const results = await eslint.lintText(
      "import { authorizationUrl } from '../src/utils/authorization-url'; export const read = (): string | null => { return authorizationUrl('https://example.com'); };",
      {
        filePath: join(root, 'apps/web/test/authorization-url.test.ts'),
      },
    );
    expect(results[0].messages).toEqual([]);
  });

  it.each([
    'dist/generated.ts',
    'apps/web/dist/generated.js',
    'out/desktop-resources/daemon/bootstrap.js',
    'release/application/main.cjs',
    'output/audit/lint-fixture.tsx',
    '.cache/node/runtime.mjs',
    '.turbo/task.js',
    'coverage/coverage.js',
    'playwright-report/report.js',
    'test-results/trace.js',
    'node_modules/dependency/index.js',
  ])('ignores generated output or dependencies at %s', async (path) => {
    const eslint = new ESLint({ cwd: root });
    const file = join(root, path);
    expect(await eslint.isPathIgnored(file)).toBe(true);
    expect(await eslint.calculateConfigForFile(file)).toBeUndefined();
  });
});
