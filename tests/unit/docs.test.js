import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocumentation } from '../../scripts/check-docs.mjs';

const fixtures = [];

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'my-pi-docs-'));
  fixtures.push(root);
  await Promise.all(
    ['apps', 'packages', 'docs/04_FEATURES'].map((directory) => {
      return mkdir(join(root, directory), { recursive: true });
    }),
  );
  const content = {
    'README.md': '# Fixture\n',
    'AGENTS.md': '# Instructions\n',
    'docs/04_FEATURES/overview.md': '# Features\n',
    ...files,
  };
  await Promise.all(
    Object.entries(content).map(async ([name, value]) => {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value);
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((root) => {
      return rm(root, { recursive: true, force: true });
    }),
  );
});

describe('feature document directory names', () => {
  it.each([
    '202610150000_feature_workspace-execution',
    '202610150930_fix_loading-scroll',
    '202610152359_refactor_feature-document-timestamps',
    '202402291200_feature_leap-day',
  ])('accepts a real calendar date and minute: %s', async (name) => {
    const root = await fixture({ [`docs/04_FEATURES/${name}/spec.md`]: '# Spec\n' });
    await expect(checkDocumentation(root)).resolves.toBe(4);
  });

  it.each([
    '20261015_feature_legacy-format',
    '20261015_0930_feature_date-time-separator',
    '202610150930_feature_workspace_execution',
    '202610150930_feature_Workspace-execution',
    '202610150930_chore_workspace-execution',
    '2026101509:30_fix_loading',
    '20261015930_fix_loading',
    '202610152400_feature_invalid-hour',
    '202610151260_feature_invalid-minute',
    '202613011200_feature_invalid-month',
    '202610321200_feature_invalid-day',
    '202602291200_feature_non-leap-day',
    '202402301200_feature_overflow-day',
  ])('rejects an invalid directory: %s', async (name) => {
    const root = await fixture({ [`docs/04_FEATURES/${name}/spec.md`]: '# Spec\n' });
    await expect(checkDocumentation(root)).rejects.toThrow('YYYYMMDDHHmm_category_name');
  });

  it('requires a Spec before verification', async () => {
    const root = await fixture({
      'docs/04_FEATURES/202610150930_feature_execution/verify.md': '# Verify\n',
    });
    await expect(checkDocumentation(root)).rejects.toThrow('必须先建立 spec.md 文件');
  });

  it('does not accept a directory named spec.md as the required file', async () => {
    const root = await fixture({
      'docs/04_FEATURES/202610150930_feature_execution/spec.md/content.md': '# Content\n',
    });
    await expect(checkDocumentation(root)).rejects.toThrow('必须先建立 spec.md 文件');
  });

  it('allows a Spec without a premature verification record', async () => {
    const root = await fixture({
      'docs/04_FEATURES/202610150930_feature_execution/spec.md': '# Spec\n',
    });
    await expect(checkDocumentation(root)).resolves.toBe(4);
  });
});

describe('documentation references and final newlines', () => {
  const spec = 'docs/04_FEATURES/202610150930_feature_execution/spec.md';

  it('resolves migrated links with fragments and retains external links', async () => {
    const root = await fixture({
      [spec]: '# Spec\n',
      'README.md': `[Spec](${spec}#spec) [External](https://example.com)\n`,
    });
    await expect(checkDocumentation(root)).resolves.toBe(4);
  });

  it('rejects a reference to an old directory after migration', async () => {
    const root = await fixture({
      [spec]: '# Spec\n',
      'README.md': '[Spec](docs/04_FEATURES/20261015_feature_execution/spec.md)\n',
    });
    await expect(checkDocumentation(root)).rejects.toThrow('无效链接');
  });

  it.each(['# Spec', '# Spec\n\n'])('rejects an invalid final newline', async (content) => {
    const root = await fixture({ [spec]: content });
    await expect(checkDocumentation(root)).rejects.toThrow('末尾需要一个换行');
  });
});
