import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { BUILTIN_PLUGIN_RESOURCE_DIRECTORY } from '../../src/plugins/index.js';
import {
  SkillCatalog,
  installSkillFiles,
  parseSkillResourceManifest,
  type SkillRoot,
} from '../../src/skills/index.js';

const directories: string[] = [];
const signal = new AbortController().signal;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('freezes exact shared dependency bytes and rejects changed source dependencies', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'shared-skill-resource-')));
  directories.push(directory);
  const bundled = join(directory, 'bundled');
  const library = join(bundled, 'plugins/shared/office/common.py');
  await mkdir(join(bundled, 'plugins/shared/office'), { recursive: true });
  await writeFile(library, 'frozen helper');
  const root = join(directory, 'skills');
  await installSkillFiles(
    root,
    'example',
    [
      {
        path: 'SKILL.md',
        content: Buffer.from(
          '---\nname: example\ndescription: Example\n---\nUse scripts/common.py.\n',
        ),
      },
      {
        path: 'resource-manifest.json',
        content: Buffer.from(
          JSON.stringify({
            version: 1,
            dependencies: [
              {
                source: 'plugins/shared/office/common.py',
                target: 'scripts/common.py',
                hash: hash('frozen helper'),
              },
            ],
          }),
        ),
      },
    ],
    signal,
  );
  const source: SkillRoot = {
    path: root,
    scope: 'plugin',
    pluginId: 'example',
    workspaceId: null,
    managed: true,
  };
  const catalog = new SkillCatalog({
    snapshotDirectory: join(directory, 'versions'),
    bundledResourceDirectory: bundled,
  });
  const [entry] = await catalog.discover([source], signal);
  if (entry === undefined) throw new Error('missing fixture');
  expect(entry.resources.map((resource) => resource.path)).toEqual([
    'resource-manifest.json',
    'scripts/common.py',
  ]);
  const frozen = await catalog.freeze(entry, signal);
  await writeFile(library, 'new helper');
  expect(await catalog.loadResource(frozen, 'scripts/common.py', signal)).toMatchObject({
    text: 'frozen helper',
  });
  await catalog.verifySnapshot(frozen, signal);
  await expect(catalog.freeze(entry, signal)).rejects.toMatchObject({ code: 'SKILL_CHANGED' });
  await expect(catalog.discover([source], signal)).rejects.toMatchObject({ code: 'SKILL_CHANGED' });
});

it.each([
  { source: '../private', target: 'scripts/helper.py', hash: 'a'.repeat(64) },
  { source: 'plugins/example/private', target: 'scripts/helper.py', hash: 'a'.repeat(64) },
  { source: 'plugins/shared/private.ts', target: 'scripts/helper.py', hash: 'a'.repeat(64) },
  {
    source: 'utils/document-view/render_pdf_pages.py',
    target: 'scripts/helper.py',
    hash: 'a'.repeat(64),
  },
  { source: 'plugins/shared/office/common.py', target: 'SKILL.md', hash: 'a'.repeat(64) },
  { source: 'plugins/shared/office/common.py', target: '../helper.py', hash: 'a'.repeat(64) },
  { source: 'plugins/shared/office/common.py', target: 'scripts/helper.py', hash: 'bad' },
])('rejects unsafe or unpinned dependency declarations', (dependency) => {
  expect(() =>
    parseSkillResourceManifest(
      Buffer.from(JSON.stringify({ version: 1, dependencies: [dependency] })),
    ),
  ).toThrow();
});

it.each(['documents', 'pdf', 'spreadsheets', 'presentations'])(
  'freezes and materializes the bundled %s Skill with its pinned shared helpers',
  async (pluginId) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'bundled-skill-resource-')));
    directories.push(directory);
    const catalog = new SkillCatalog({
      snapshotDirectory: join(directory, 'profile/versions'),
      materializationDirectory: join(directory, 'readable'),
      protectedDirectories: [join(directory, 'profile')],
    });
    const [entry] = await catalog.discover(
      [
        {
          path: join(BUILTIN_PLUGIN_RESOURCE_DIRECTORY, pluginId, 'skills'),
          scope: 'plugin',
          pluginId,
          workspaceId: null,
          managed: true,
        },
      ],
      signal,
    );
    if (entry === undefined) throw new Error('missing bundled Skill');
    const frozen = await catalog.freeze(entry, signal);
    expect(frozen.resources.some((resource) => resource.path === 'scripts/common.py')).toBe(true);
    const lease = await catalog.materializeBindings([frozen], signal, () => Promise.resolve());
    try {
      await lease.verify(signal);
      expect(lease.bindings).toHaveLength(1);
      expect((await catalog.loadResource(frozen, 'scripts/common.py', signal)).type).toBe('text');
    } finally {
      await lease.release();
    }
  },
);
