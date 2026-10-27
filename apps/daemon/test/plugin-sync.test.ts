import { mkdtemp, mkdir, realpath, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openProfileStore } from '@my-pi-harness/storage';
import { SkillsService } from '../src/skills/service.js';
import { PluginService, type PluginAppPort } from '../src/plugins/service.js';

const cleanup: (() => Promise<void>)[] = [];
const signal = new AbortController().signal;
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'plugin-sync-')));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  const store = await openProfileStore(profile, {
    sessionLogRoot: join(directory, '.my-pi-harness'),
  });
  const skills = new SkillsService({
    repository: store.extensions,
    profileDirectory: profile,
    resolveWorkspace: () => Promise.reject(new Error('No workspace in fixture')),
  });
  let appInstalls = 0;
  const apps: PluginAppPort = {
    install(id, app) {
      appInstalls++;
      return Promise.resolve(`${id}:${app.id}:owned`);
    },
    setEnabled() {
      return Promise.resolve();
    },
    remove() {
      return Promise.reject(new Error('Sync must not remove an App'));
    },
  };
  const plugins = new PluginService({
    repository: store.extensions,
    profileDirectory: profile,
    skills,
    apps,
  });
  cleanup.push(async () => {
    await plugins.close();
    await skills.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, profile, store, skills, plugins, installs: () => appInstalls };
}

it('adds bundled task Skills while preserving exact App references, disabled preferences and frozen revocation', async () => {
  const f = await fixture();
  const installed = await f.plugins.install('github', signal);
  const record = f.store.extensions.plugins()[0];
  if (record === undefined) throw new Error('missing installed record');
  const original = (await f.skills.list(null, signal)).find((skill) => skill.name === 'github');
  if (original === undefined) throw new Error('missing router');
  const frozen = await f.skills.freezeSelections(
    null,
    [{ id: original.id, contentHash: original.contentHash }],
    signal,
  );
  const router = record.components.find((entry) => entry.id === 'skill:github');
  const app = record.components.find((entry) => entry.kind === 'app');
  if (router === undefined || app === undefined) throw new Error('missing components');
  for (const name of ['github-reviews', 'github-actions', 'github-publish'])
    await rm(join(record.directory, 'skills', name), { recursive: true });
  await writeFile(
    join(record.directory, 'skills', 'github', 'SKILL.md'),
    '---\nname: github\ndescription: Old bundled router\nallowed-tools: github\n---\nOld bundled instructions\n',
  );
  f.store.extensions.savePlugin(
    {
      ...record,
      revision: installed.revision + 1,
      components: [app, { ...router, enabled: false }],
    },
    installed.revision,
  );
  await f.plugins.synchronize(signal);
  const result = f.plugins.list().find((entry) => entry.manifest.id === 'github');
  if (result === undefined) throw new Error('missing synchronized plugin');
  expect(result.enabled).toBe(true);
  expect(result.components.filter((entry) => entry.kind === 'skill')).toHaveLength(4);
  expect(result.components.find((entry) => entry.id === 'skill:github')).toMatchObject({
    enabled: false,
    referenceId: original.id,
  });
  expect(result.components.find((entry) => entry.kind === 'app')).toEqual(app);
  expect(f.installs()).toBe(1);
  expect(await readdir(record.directory)).toEqual(['skills']);
  expect(
    await readFile(join(record.directory, 'skills', 'github', 'references', 'access.md'), 'utf8'),
  ).toContain('gatewayUrl');
  expect(() => f.skills.assertBindingsCurrent(frozen)).toThrow();
  const updated = await f.skills.list(null, signal);
  expect(updated.find((entry) => entry.name === 'github-actions')).toMatchObject({ enabled: true });
});

it('reconciles stale installed resources before use, leaves user Skills untouched and is idempotent', async () => {
  const f = await fixture();
  await f.skills.create(
    {
      scope: 'user',
      workspaceId: null,
      name: 'personal',
      description: 'Personal instructions',
      content: 'Keep this user-authored content',
    },
    signal,
  );
  const installed = await f.plugins.install('github', signal);
  const record = f.store.extensions.plugins()[0];
  if (record === undefined) throw new Error('missing installed record');
  const router = record.components.find((entry) => entry.id === 'skill:github');
  const app = record.components.find((entry) => entry.kind === 'app');
  if (router === undefined || app === undefined) throw new Error('missing components');
  const [frozen] = await f.skills.freezeSelections(
    null,
    [
      {
        id: router.referenceId,
        contentHash: (await f.skills.detail(router.referenceId, null, signal)).contentHash,
      },
    ],
    signal,
  );
  if (frozen === undefined) throw new Error('missing frozen Skill');
  for (const name of ['github-reviews', 'github-actions', 'github-publish'])
    await rm(join(record.directory, 'skills', name), { recursive: true });
  await writeFile(
    join(record.directory, 'skills', 'github', 'SKILL.md'),
    '---\nname: github\ndescription: Old router\n---\nOld installed content\n',
  );
  f.store.extensions.savePlugin(
    {
      ...record,
      revision: installed.revision + 1,
      components: [app, { ...router, enabled: false }],
    },
    installed.revision,
  );
  await f.plugins.synchronize(signal);
  const current = f.plugins.list().find((plugin) => plugin.manifest.id === 'github');
  expect(current?.components.filter((component) => component.kind === 'skill')).toHaveLength(4);
  expect(current?.components.find((component) => component.id === router.id)).toMatchObject({
    enabled: false,
  });
  expect(current?.components.find((component) => component.id === app.id)).toEqual(app);
  expect(f.installs()).toBe(1);
  expect(
    (await f.skills.list(null, signal)).find((skill) => skill.name === 'personal'),
  ).toMatchObject({ enabled: true });
  expect(await readFile(join(f.profile, 'skills', 'personal', 'SKILL.md'), 'utf8')).toContain(
    'Keep this user-authored content',
  );
  expect(() => f.skills.assertBindingsCurrent([frozen])).toThrow();
  await f.plugins.synchronize(signal);
  expect(f.plugins.list().find((plugin) => plugin.manifest.id === 'github')).toEqual(current);
  expect(f.installs()).toBe(1);
});

it('shows installed instructions rather than a newer bundled preview, including disabled plugins', async () => {
  const f = await fixture();
  const installed = await f.plugins.install('documents', signal);
  const source = join(f.profile, 'plugins', 'documents', 'skills', 'documents', 'SKILL.md');
  await writeFile(
    source,
    '---\nname: documents\ndescription: Actual installed version\n---\nThis is what the Agent will read.\n',
  );
  const detail = await f.plugins.detail('documents', signal);
  expect(detail.skills).toEqual([
    {
      name: 'documents',
      description: 'Actual installed version',
      content: 'This is what the Agent will read.',
    },
  ]);
  const [view] = await f.skills.list(null, signal);
  if (view === undefined) throw new Error('missing Skill');
  expect((await f.skills.detail(view.id, null, signal)).content).toBe(detail.skills[0]?.content);
  await f.plugins.control('documents', installed.revision, false);
  expect((await f.plugins.detail('documents', signal)).skills).toEqual(detail.skills);
});

it('does not replace retained instructions during automatic synchronization and repairs stale references after release', async () => {
  const f = await fixture();
  const plugin = await f.plugins.install('documents', signal);
  const [skill] = await f.skills.list(null, signal);
  if (skill === undefined) throw new Error('missing Skill');
  const frozen = await f.skills.freezeSelections(
    null,
    [{ id: skill.id, contentHash: skill.contentHash }],
    signal,
  );
  const release = f.skills.retainBindings(frozen);
  await writeFile(
    join(f.profile, 'plugins', 'documents', 'skills', 'documents', 'references', 'layout.md'),
    'An older resource',
  );
  try {
    await expect(f.plugins.synchronize(signal)).rejects.toMatchObject({ code: 'SKILL_BUSY' });
    expect(f.plugins.list().find((entry) => entry.manifest.id === 'documents')?.revision).toBe(
      plugin.revision,
    );
    await f.skills.validateBindings(frozen, signal);
  } finally {
    release();
  }
  await f.plugins.synchronize(signal);
  const updated = f.store.extensions.plugins()[0];
  if (updated === undefined) throw new Error('missing plugin');
  f.store.extensions.savePlugin(
    {
      ...updated,
      revision: updated.revision + 1,
      components: updated.components.map((component) => ({
        ...component,
        referenceId: 'stale-owned-reference',
      })),
    },
    updated.revision,
  );
  await f.plugins.synchronize(signal);
  expect(f.store.extensions.plugins()[0]?.components[0]?.referenceId).toBe(skill.id);
});

it('preserves disabled plugin state while replacing stale bundled resources', async () => {
  const f = await fixture();
  const installed = await f.plugins.install('documents', signal);
  await f.plugins.control('documents', installed.revision, false);
  const resource = join(
    f.profile,
    'plugins',
    'documents',
    'skills',
    'documents',
    'references',
    'authoring.md',
  );
  await writeFile(resource, 'An older bundled resource');
  await f.plugins.synchronize(signal);
  expect(f.plugins.list().find((entry) => entry.manifest.id === 'documents')).toMatchObject({
    enabled: false,
    installed: true,
  });
  expect(await readFile(resource, 'utf8')).not.toBe('An older bundled resource');
});

it('restores previous resources after a publication failure without reviving old authorization', async () => {
  const f = await fixture();
  const plugin = await f.plugins.install('documents', signal);
  const root = join(f.profile, 'plugins', 'documents', 'skills', 'documents');
  const original = await readFile(join(root, 'SKILL.md'), 'utf8');
  await writeFile(join(root, 'references', 'layout.md'), 'An older bundled resource');
  const [skill] = await f.skills.list(null, signal);
  if (skill === undefined) throw new Error('missing Skill');
  const frozen = await f.skills.freezeSelections(
    null,
    [{ id: skill.id, contentHash: skill.contentHash }],
    signal,
  );
  const save = f.store.extensions.savePlugin.bind(f.store.extensions);
  let writes = 0;
  const spy = vi.spyOn(f.store.extensions, 'savePlugin').mockImplementation((input, expected) => {
    writes++;
    if (writes === 2) throw new Error('fixture publication failed');
    return save(input, expected);
  });
  try {
    await expect(f.plugins.synchronize(signal)).rejects.toThrow('fixture publication failed');
    expect(await readFile(join(root, 'SKILL.md'), 'utf8')).toBe(original);
    const stored = f.plugins.list().find((entry) => entry.manifest.id === 'documents');
    expect(stored).toMatchObject({ enabled: true, revision: plugin.revision + 2 });
    expect(stored?.components).toEqual(plugin.components);
    expect(() => f.skills.assertBindingsCurrent(frozen)).toThrow();
    expect(await readdir(join(f.profile, 'plugins', 'documents'))).toEqual(['skills']);
  } finally {
    spy.mockRestore();
  }
});
