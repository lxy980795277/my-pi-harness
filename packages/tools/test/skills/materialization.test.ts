import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import {
  SkillCatalog,
  installSkillFiles,
  type AssertSkillAuthorized,
  type SkillRoot,
} from '../../src/skills/index.js';

const directories: string[] = [];
const signal = new AbortController().signal;
const authorized: AssertSkillAuthorized = (_skill, signal) => {
  signal.throwIfAborted();
  return Promise.resolve();
};
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'skill-resource-lease-')));
  directories.push(directory);
  const profile = join(directory, 'profile');
  const root = join(profile, 'skills');
  const catalog = new SkillCatalog({
    snapshotDirectory: join(profile, 'versions'),
    materializationDirectory: join(directory, 'resources'),
    protectedDirectories: [profile],
  });
  await installSkillFiles(
    root,
    'example',
    [
      {
        path: 'SKILL.md',
        content: Buffer.from(
          '---\nname: example\ndescription: Example\n---\nRun scripts/example.py.\n',
        ),
      },
      { path: 'scripts/example.py', content: Buffer.from('print("accepted version")\n') },
    ],
    signal,
  );
  const source: SkillRoot = {
    path: root,
    scope: 'user',
    pluginId: null,
    workspaceId: null,
    managed: true,
  };
  const [entry] = await catalog.discover([source], signal);
  if (entry === undefined) throw new Error('missing fixture');
  const frozen = await catalog.freeze(entry, signal, {
    skillEpoch: 3,
    pluginId: null,
    pluginEpoch: 0,
    pluginGeneration: null,
  });
  return { directory, profile, catalog, frozen };
}

it('materializes accepted bytes outside the profile and retains an independent command reference', async () => {
  const f = await fixture();
  const run = await f.catalog.materializeBindings([f.frozen], signal, authorized);
  const path = run.bindings[0]?.directory;
  if (path === undefined) throw new Error('missing resource binding');
  const command = await run.retain(signal);
  try {
    expect(path.startsWith(f.profile)).toBe(false);
    expect(run.readOnlyDirectories).toEqual([path]);
    expect((await stat(path)).mode & 0o222).toBe(0);
    expect((await stat(join(path, 'scripts/example.py'))).mode & 0o222).toBe(0);
    await run.release();
    await run.release();
    expect(await readFile(join(path, 'scripts/example.py'), 'utf8')).toContain('accepted version');
    expect(() => f.catalog.assertRemovable(f.frozen.selection.id)).toThrow('command');
    await expect(run.retain(signal)).rejects.toMatchObject({ code: 'SKILL_REVOKED' });
    await command.verify(signal);
  } finally {
    await run.release();
    await command.release();
  }
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(() => f.catalog.assertRemovable(f.frozen.selection.id)).not.toThrow();
});

it('rejects unactivated or stale authorization and keeps revoked command bytes until release', async () => {
  const f = await fixture();
  let active = false;
  const check: AssertSkillAuthorized = (skill) => {
    if (!active || skill.authorization.skillEpoch !== 3) throw new Error('Skill is not activated');
    return Promise.resolve();
  };
  await expect(f.catalog.materializeBindings([f.frozen], signal, check)).rejects.toThrow(
    'not activated',
  );
  active = true;
  const run = await f.catalog.materializeBindings([f.frozen], signal, check);
  const command = await run.retain(signal);
  try {
    active = false;
    await expect(run.retain(signal)).rejects.toThrow('not activated');
    f.catalog.revokeBindings(new Set([f.frozen.selection.id]));
    await expect(command.verify(signal)).rejects.toMatchObject({ code: 'SKILL_REVOKED' });
    await run.release();
    expect(
      await readFile(join(command.readOnlyDirectories[0] ?? '', 'scripts/example.py'), 'utf8'),
    ).toContain('accepted version');
    f.catalog.close();
    await expect(
      f.catalog.materializeBindings([f.frozen], signal, authorized),
    ).rejects.toMatchObject({ code: 'SKILL_REVOKED' });
  } finally {
    await run.release();
    await command.release();
  }
});

it('rejects modified materialized resources before a new command acquires a reference', async () => {
  const f = await fixture();
  const run = await f.catalog.materializeBindings([f.frozen], signal, authorized);
  try {
    const path = join(run.readOnlyDirectories[0] ?? '', 'scripts/example.py');
    await chmod(path, 0o600);
    await writeFile(path, 'changed');
    await expect(run.retain(signal)).rejects.toMatchObject({ code: 'SKILL_SNAPSHOT' });
  } finally {
    await run.release();
  }
  expect(() => f.catalog.assertRemovable(f.frozen.selection.id)).not.toThrow();
});

it('refuses to materialize under or around a protected profile', async () => {
  const f = await fixture();
  for (const materializationDirectory of [join(f.profile, 'readable'), f.directory]) {
    const catalog = new SkillCatalog({
      snapshotDirectory: join(f.profile, 'versions'),
      materializationDirectory,
      protectedDirectories: [f.profile],
    });
    await expect(catalog.materializeBindings([f.frozen], signal, authorized)).rejects.toMatchObject(
      { code: 'SKILL_PATH' },
    );
  }
  await mkdir(join(f.directory, 'unused'));
});
