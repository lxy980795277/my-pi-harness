import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsService } from '../src/features/skills/service.js';
import { PluginService, type PluginAppPort } from '../src/features/plugins/service.js';
import { registerSkillRoutes } from '../src/features/skills/routes.js';
import { registerPluginRoutes } from '../src/features/plugins/routes.js';

const fixtures: { directory: string; store: ProfileStore; skills: SkillsService }[] = [];
const signal = new AbortController().signal;
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-extension-api-')));
  const profile = join(directory, 'profile');
  const project = join(directory, 'project');
  await mkdir(project);
  const store = await openProfileStore(profile);
  const skills = new SkillsService({
    repository: store.extensions,
    profileDirectory: profile,
    resolveWorkspace: (id) => {
      if (id !== 'project') throw new Error('unregistered workspace');
      return Promise.resolve({
        id,
        name: 'Project',
        icon: 'folder',
        rootPath: project,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    },
  });
  const removed: string[] = [];
  const enabled: string[] = [];
  const apps: PluginAppPort = {
    install(pluginId, app) {
      return Promise.resolve(`${pluginId}:${app.id}:owned-server`);
    },
    setEnabled(pluginId, componentId, referenceId) {
      enabled.push(`${pluginId}/${componentId}/${referenceId}`);
      return Promise.resolve();
    },
    remove(pluginId, componentId, referenceId) {
      removed.push(`${pluginId}/${componentId}/${referenceId}`);
      return Promise.resolve();
    },
  };
  const plugins = new PluginService({
    repository: store.extensions,
    profileDirectory: profile,
    skills,
    apps,
  });
  fixtures.push({ directory, store, skills });
  return { directory, profile, project, store, skills, plugins, removed, enabled };
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.skills.close();
    f.store.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
describe('Skill and plugin installation ownership', () => {
  it('creates, freezes, revokes and re-enables without reviving accepted grants', async () => {
    const f = await fixture();
    const skill = await f.skills.create(
      {
        scope: 'user',
        workspaceId: null,
        name: 'example',
        description: 'Example task',
        content: 'Original instructions',
      },
      signal,
    );
    const [frozen] = await f.skills.freezeSelections(
      null,
      [{ id: skill.id, contentHash: skill.contentHash }],
      signal,
    );
    if (!frozen) throw new Error('missing');
    await writeFile(
      join(f.profile, 'skills/example/SKILL.md'),
      '---\nname: example\ndescription: Changed task\n---\nChanged instructions\n',
    );
    await f.skills.validateBindings([frozen], signal);
    expect(frozen.content).toBe('Original instructions');
    await expect(f.skills.freezeSelections(null, [frozen.selection], signal)).rejects.toMatchObject(
      { code: 'SKILL_STALE' },
    );
    const current = (await f.skills.list(null, signal))[0];
    if (!current) throw new Error('missing');
    await f.skills.control(current.id, null, current.contentHash, false, signal);
    await f.skills.control(current.id, null, current.contentHash, true, signal);
    await expect(f.skills.validateBindings([frozen], signal)).rejects.toMatchObject({
      code: 'SKILL_REVOKED',
    });
  });
  it('requires a workspace only for project installs and does not delete compatible project sources', async () => {
    const f = await fixture();
    await expect(
      f.skills.create(
        {
          scope: 'project',
          workspaceId: null,
          name: 'example',
          description: 'Example',
          content: 'Task',
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'SKILL_SCOPE' });
    await mkdir(join(f.project, '.agents/skills/example'), { recursive: true });
    await writeFile(
      join(f.project, '.agents/skills/example/SKILL.md'),
      '---\nname: example\ndescription: Example\n---\nTask',
    );
    const [skill] = await f.skills.list('project', signal);
    if (!skill) throw new Error('missing');
    await expect(
      f.skills.remove(skill.id, 'project', skill.contentHash, signal),
    ).rejects.toMatchObject({ code: 'SKILL_OWNER' });
    expect(await f.skills.list(null, signal)).toEqual([]);
  });
  it('keeps active Skill resources and preserves a revocation tombstone after uninstall', async () => {
    const f = await fixture();
    const skill = await f.skills.create(
      {
        scope: 'user',
        workspaceId: null,
        name: 'example',
        description: 'Example',
        content: 'Task',
      },
      signal,
    );
    const frozen = await f.skills.freezeSelections(
      null,
      [{ id: skill.id, contentHash: skill.contentHash }],
      signal,
    );
    const release = f.skills.retainBindings(frozen);
    await expect(f.skills.remove(skill.id, null, skill.contentHash, signal)).rejects.toMatchObject({
      code: 'SKILL_BUSY',
    });
    release();
    await f.skills.remove(skill.id, null, skill.contentHash, signal);
    expect(await f.skills.list(null, signal)).toEqual([]);
    await expect(f.skills.validateBindings(frozen, signal)).rejects.toMatchObject({
      code: 'SKILL_REVOKED',
    });
    expect(f.store.extensions.skills()[0]?.enabled).toBe(false);
  });
  it('installs nine finite plugins and removes exact owned App references', async () => {
    const f = await fixture();
    expect(f.plugins.list()).toHaveLength(9);
    const installed = await f.plugins.install('github', signal);
    expect(installed.components).toHaveLength(2);
    expect(installed.revision).toBe(1);
    const [skill] = await f.skills.list(null, signal);
    if (!skill) throw new Error('missing');
    const frozen = await f.skills.freezeSelections(
      null,
      [{ id: skill.id, contentHash: skill.contentHash }],
      signal,
    );
    const release = f.skills.retainBindings(frozen);
    await expect(f.plugins.remove('github', installed.revision)).rejects.toMatchObject({
      code: 'SKILL_BUSY',
    });
    expect(f.removed).toEqual([]);
    release();
    const disabled = await f.plugins.control('github', installed.revision, false);
    await expect(f.skills.validateBindings(frozen, signal)).rejects.toMatchObject({
      code: 'SKILL_REVOKED',
    });
    await f.plugins.remove('github', disabled.revision);
    expect(f.removed).toEqual(['github/github/github:github:owned-server']);
    expect(await readdir(join(f.profile, 'plugins'))).toEqual([]);
  });
  it('supports HTTP create, metadata, detail, controls and office plugin assembly', async () => {
    const f = await fixture();
    const server = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    registerSkillRoutes(server, f.skills);
    registerPluginRoutes(server, f.plugins);
    try {
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/skills',
            payload: {
              scope: 'user',
              workspaceId: null,
              name: 'example',
              description: 'Example task',
              content: 'Skill body',
              unexpected: true,
            },
          })
        ).statusCode,
      ).toBe(400);
      const created = await server.inject({
        method: 'POST',
        url: '/api/skills',
        payload: {
          scope: 'user',
          workspaceId: null,
          name: 'example',
          description: 'Example task',
          content: 'Skill body',
        },
      });
      expect(created.statusCode).toBe(200);
      const list = await server.inject('/api/skills');
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain('Skill body');
      const install = await server.inject({
        method: 'POST',
        url: '/api/plugins/documents/install',
      });
      expect(install.statusCode).toBe(200);
      expect(install.body).toContain('documents');
    } finally {
      await server.close();
    }
  });
  it('does not revive a removed Skill or plugin generation after reinstall', async () => {
    const f = await fixture();
    const input = {
      scope: 'user' as const,
      workspaceId: null,
      name: 'example',
      description: 'Example',
      content: 'Task',
    };
    const skill = await f.skills.create(input, signal);
    const frozen = await f.skills.freezeSelections(
      null,
      [{ id: skill.id, contentHash: skill.contentHash }],
      signal,
    );
    await f.skills.remove(skill.id, null, skill.contentHash, signal);
    const installedAgain = await f.skills.create(input, signal);
    expect(installedAgain.id).toBe(skill.id);
    await expect(f.skills.validateBindings(frozen, signal)).rejects.toMatchObject({
      code: 'SKILL_REVOKED',
    });
    const plugin = await f.plugins.install('documents', signal);
    const [pluginSkill] = (await f.skills.list(null, signal)).filter(
      (entry) => entry.pluginId === 'documents',
    );
    if (!pluginSkill) throw new Error('missing');
    const pluginFrozen = await f.skills.freezeSelections(
      null,
      [{ id: pluginSkill.id, contentHash: pluginSkill.contentHash }],
      signal,
    );
    await f.plugins.remove('documents', plugin.revision);
    await f.plugins.install('documents', signal);
    await expect(f.skills.validateBindings(pluginFrozen, signal)).rejects.toMatchObject({
      code: 'SKILL_REVOKED',
    });
  });
  it('keeps same-name App and Skill component controls separate', async () => {
    const f = await fixture();
    const plugin = await f.plugins.install('github', signal);
    expect(new Set(plugin.components.map((entry) => entry.id)).size).toBe(2);
    const updated = await f.plugins.component('github', 'skill:github', plugin.revision, false);
    expect(f.enabled).toEqual([]);
    expect(updated.components.find((entry) => entry.kind === 'app')?.enabled).toBe(true);
    expect((await f.skills.list(null, signal))[0]?.enabled).toBe(false);
  });
  it('aborts an owned plugin installation and waits for staging cleanup before close', async () => {
    const f = await fixture();
    let started: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const apps: PluginAppPort = {
      install(_pluginId, _app, ownedSignal) {
        started();
        return new Promise((_resolve, reject) => {
          ownedSignal.addEventListener(
            'abort',
            () => reject(new Error('cancelled fixture install')),
            { once: true },
          );
        });
      },
      setEnabled() {
        return Promise.resolve();
      },
      remove() {
        return Promise.resolve();
      },
    };
    const plugins = new PluginService({
      repository: f.store.extensions,
      profileDirectory: f.profile,
      skills: f.skills,
      apps,
    });
    const installing = plugins.install('github', signal);
    const observedFailure = expect(installing).rejects.toThrow('cancelled fixture install');
    await entered;
    await expect(plugins.install('github', signal)).rejects.toMatchObject({ code: 'PLUGIN_BUSY' });
    await plugins.close();
    await observedFailure;
    expect(f.store.extensions.plugins()).toEqual([]);
    expect(await readdir(join(f.profile, 'plugins'))).toEqual([]);
    await expect(plugins.install('documents', signal)).rejects.toMatchObject({
      code: 'PLUGIN_CLOSED',
    });
  });
});
