import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillCatalog } from '../../src/skills/catalog.js';
import { parseSkill } from '../../src/skills/parser.js';
import { installSkillFiles } from '../../src/skills/install.js';
import type { SkillRoot } from '../../src/skills/types.js';

const directories: string[] = [];
const signal = new AbortController().signal;
const body =
  '---\nname: example\ndescription: Example task support\nallowed-tools: read_file shell\n---\n\nUse references/details.md when necessary.\n';
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-skills-')));
  directories.push(directory);
  const root = join(directory, 'skills');
  await mkdir(root);
  const catalog = new SkillCatalog({ snapshotDirectory: join(directory, 'versions') });
  const source: SkillRoot = {
    path: root,
    scope: 'user',
    pluginId: null,
    workspaceId: null,
    managed: true,
  };
  return { directory, root, catalog, source };
}
async function install(root: string) {
  return await installSkillFiles(
    root,
    'example',
    [
      { path: 'SKILL.md', content: Buffer.from(body) },
      { path: 'references/details.md', content: Buffer.from('frozen reference') },
    ],
    signal,
  );
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
describe('standard Skill parsing and immutable resources', () => {
  it('parses YAML fields while keeping allowed-tools as declarations', () => {
    const parsed = parseSkill(body, 'example');
    expect(parsed.allowedTools).toEqual(['read_file', 'shell']);
    expect(parsed.content).toContain('references/details.md');
  });
  it.each([
    '---\nname: example\nname: example\ndescription: x\n---\nx',
    '---\nname: other\ndescription: x\n---\nx',
    '---\nname: example\ndescription: !custom x\n---\nx',
    '---\nname: example\ndescription: &x text\nmetadata: *x\n---\nx',
  ])('rejects malformed or unsafe Skill metadata', (text) => {
    expect(() => parseSkill(text, 'example')).toThrow();
  });
  it('freezes resources and preserves the original bytes after source modification', async () => {
    const f = await fixture();
    const installed = await install(f.root);
    const [entry] = await f.catalog.discover([f.source], signal);
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error('missing fixture');
    const frozen = await f.catalog.freeze(entry, signal);
    await writeFile(join(installed, 'references/details.md'), 'modified reference');
    const content = await f.catalog.loadResource(frozen, 'references/details.md', signal);
    expect(content).toMatchObject({ type: 'text', text: 'frozen reference' });
    await expect(f.catalog.freeze(entry, signal)).rejects.toMatchObject({ code: 'SKILL_CHANGED' });
    await expect(f.catalog.loadResource(frozen, '../outside', signal)).rejects.toMatchObject({
      code: 'SKILL_PATH',
    });
    await expect(f.catalog.loadResource(frozen, 'missing.md', signal)).rejects.toMatchObject({
      code: 'SKILL_RESOURCE',
    });
    const release = f.catalog.retainBindings([frozen]);
    expect(() => f.catalog.assertRemovable(entry.id)).toThrow('active Run');
    release();
    release();
    expect(() => f.catalog.assertRemovable(entry.id)).not.toThrow();
  });
  it('rejects symlinks and checks a modified frozen resource against its hash', async () => {
    const f = await fixture();
    const installed = await install(f.root);
    const [entry] = await f.catalog.discover([f.source], signal);
    if (!entry) throw new Error('missing');
    const frozen = await f.catalog.freeze(entry, signal);
    await chmod(
      join(f.directory, 'versions', frozen.selection.contentHash, 'references/details.md'),
      0o600,
    );
    await writeFile(
      join(f.directory, 'versions', frozen.selection.contentHash, 'references/details.md'),
      'corrupted',
    );
    await expect(
      f.catalog.loadResource(frozen, 'references/details.md', signal),
    ).rejects.toMatchObject({ code: 'SKILL_SNAPSHOT' });
    await symlink('/etc/passwd', join(installed, 'outside'));
    await expect(f.catalog.discover([f.source], signal)).rejects.toMatchObject({
      code: 'SKILL_SYMLINK',
    });
  });
  it('orders scope collisions explicitly and works without a project root', async () => {
    const f = await fixture();
    await install(f.root);
    const project = join(f.directory, 'project');
    await mkdir(project);
    await install(project);
    const entries = await f.catalog.discover(
      [f.source, { ...f.source, path: project, scope: 'project', workspaceId: 'workspace' }],
      signal,
    );
    expect(entries.map((entry) => [entry.scope, entry.shadowed])).toEqual([
      ['project', false],
      ['user', true],
    ]);
    expect(await f.catalog.discover([f.source], signal)).toHaveLength(1);
  });
  it('does not overwrite same-name directories and cleans cancelled staging', async () => {
    const f = await fixture();
    const target = await install(f.root);
    const original = await readFile(join(target, 'SKILL.md'), 'utf8');
    await expect(install(f.root)).rejects.toMatchObject({ code: 'SKILL_CONFLICT' });
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(original);
    const controller = new AbortController();
    controller.abort();
    await expect(
      installSkillFiles(
        f.root,
        'cancelled',
        [{ path: 'SKILL.md', content: Buffer.from(body.replace('example', 'cancelled')) }],
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(await readdir(f.root)).toEqual(['example']);
  });
});
