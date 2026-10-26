import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { previewBuiltinPluginSkills } from '../src/plugins/preview.js';
import { BUILTIN_PLUGINS, BUILTIN_PLUGIN_RESOURCE_DIRECTORY } from '../src/plugins/catalog.js';
import { parseSkill } from '../src/skills/parser.js';

const temporary: string[] = [];
const signal = new AbortController().signal;
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

it('returns complete authored Markdown for every finite built-in plugin without installation', async () => {
  for (const manifest of BUILTIN_PLUGINS) {
    const previews = await previewBuiltinPluginSkills(manifest.id, signal);
    expect(previews.map((preview) => preview.name)).toEqual(manifest.skills);
    for (const preview of previews) {
      const text = await readFile(
        join(BUILTIN_PLUGIN_RESOURCE_DIRECTORY, manifest.id, 'skills', preview.name, 'SKILL.md'),
        'utf8',
      );
      const parsed = parseSkill(text, preview.name);
      expect(preview).toEqual({
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
      });
      expect(preview.content.length).toBeGreaterThan(100);
      expect(preview).not.toHaveProperty('source');
      expect(preview).not.toHaveProperty('resources');
    }
  }
});

it('rejects unknown identities and cancellation before touching resources', async () => {
  await expect(previewBuiltinPluginSkills('../github', signal, '/missing')).rejects.toMatchObject({
    code: 'PLUGIN_NOT_FOUND',
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    previewBuiltinPluginSkills('github', controller.signal, '/missing'),
  ).rejects.toThrow();
});

it('rejects malformed, oversized or non-UTF8 bundled Skill documents', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'plugin-preview-')));
  temporary.push(directory);
  const source = join(directory, 'github', 'skills', 'github');
  await mkdir(source, { recursive: true });
  const path = join(source, 'SKILL.md');
  await writeFile(path, '---\nname: other\ndescription: Fixture\n---\nBody');
  await expect(previewBuiltinPluginSkills('github', signal, directory)).rejects.toMatchObject({
    code: 'SKILL_NAME',
  });
  await writeFile(path, Buffer.from([0xff, 0xfe]));
  await expect(previewBuiltinPluginSkills('github', signal, directory)).rejects.toMatchObject({
    code: 'PLUGIN_RESOURCE',
  });
  await writeFile(path, 'x'.repeat(131073));
  await expect(previewBuiltinPluginSkills('github', signal, directory)).rejects.toMatchObject({
    code: 'SKILL_TOO_LARGE',
  });
});

it.skipIf(process.platform === 'win32')('rejects linked bundled Skill files', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'plugin-preview-link-')));
  temporary.push(directory);
  const source = join(directory, 'github', 'skills', 'github');
  await mkdir(source, { recursive: true });
  const path = join(source, 'SKILL.md');
  const outside = join(directory, 'external.md');
  await writeFile(outside, '---\nname: github\ndescription: Fixture\n---\nBody');
  await symlink(outside, path);
  await expect(previewBuiltinPluginSkills('github', signal, directory)).rejects.toMatchObject({
    code: 'SKILL_SYMLINK',
  });
});
