import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { SkillCatalog } from '@my-pi-harness/tools/skills';
import { DOCUMENT_VIEW_RESOURCE_DIRECTORY } from '@my-pi-harness/tools';
import { BUILTIN_PLUGIN_RESOURCE_DIRECTORY, BUILTIN_PLUGIN_SKILL_RESOURCES } from '../src/index';

const directories: string[] = [];
const signal = new AbortController().signal;
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
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
      resourceSources: {
        ...BUILTIN_PLUGIN_SKILL_RESOURCES,
        'utils/document-view/pdf_safety.py': {
          directory: DOCUMENT_VIEW_RESOURCE_DIRECTORY,
          path: 'pdf_safety.py',
        },
      },
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
