import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import {
  SkillCatalog,
  installSkillFiles,
  parseSkillResourceManifest,
  type SkillRoot,
} from '../../src/skills/index';

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
    resourceSources: {
      'plugins/shared/office/common.py': {
        directory: bundled,
        path: 'plugins/shared/office/common.py',
      },
    },
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

it.each(['unregistered.py', 'toString', '__proto__'])(
  'rejects the undeclared resource source %s before opening a host file',
  async (source) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'unregistered-skill-resource-')));
    directories.push(directory);
    const root = join(directory, 'skills');
    await installSkillFiles(
      root,
      'example',
      [
        {
          path: 'SKILL.md',
          content: Buffer.from('---\nname: example\ndescription: Example\n---\nInstructions\n'),
        },
        {
          path: 'resource-manifest.json',
          content: Buffer.from(
            JSON.stringify({
              version: 1,
              dependencies: [{ source, target: 'scripts/helper.py', hash: 'a'.repeat(64) }],
            }),
          ),
        },
      ],
      signal,
    );
    const catalog = new SkillCatalog({ snapshotDirectory: join(directory, 'versions') });
    await expect(
      catalog.discover(
        [{ path: root, scope: 'user', pluginId: null, workspaceId: null, managed: true }],
        signal,
      ),
    ).rejects.toMatchObject({ code: 'SKILL_MANIFEST' });
  },
);
