import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  SkillCatalog,
  PluginError,
  installSkillFiles,
  readSkillTree,
  syncSkillDirectory,
} from '@my-pi-harness/integrations';
import type { PluginManifest, PluginComponent } from '@my-pi-harness/protocol';
import type { ExtensionRepository, StoredPlugin } from '@my-pi-harness/storage';
import type { SkillsService } from '../skills/service.js';

interface PluginSyncOptions {
  plugin: StoredPlugin;
  manifest: PluginManifest;
  repository: ExtensionRepository;
  skills: SkillsService;
  profileDirectory: string;
  resourceDirectory: string;
}

/** Replace stale bundled Skills during startup; App references and credentials stay with their owners. */
export async function syncPluginSkills(
  options: PluginSyncOptions,
  signal: AbortSignal,
): Promise<void> {
  const { plugin, manifest, repository, skills } = options;
  const directory = resolve(options.profileDirectory, 'plugins', plugin.id);
  if (resolve(plugin.directory) !== directory || (await realpath(directory)) !== directory)
    throw new PluginError('PLUGIN_OWNER', 'Plugin installation directory changed');
  const root = join(directory, 'skills');
  const staging = join(directory, `.sync-new-${randomUUID()}`);
  const backup = join(directory, `.sync-old-${randomUUID()}`);
  let previous: StoredPlugin | undefined;
  let moved = false;
  let published = false;
  let committed = false;
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const name of manifest.skills) {
      const files = await readSkillTree(
        join(options.resourceDirectory, plugin.id, 'skills', name),
        signal,
      );
      await installSkillFiles(staging, name, files, signal);
    }
    signal.throwIfAborted();
    const current = repository.plugins().find((entry) => entry.id === plugin.id);
    if (
      current === undefined ||
      current.revision !== plugin.revision ||
      current.generation !== plugin.generation
    )
      throw new PluginError('PLUGIN_CONFLICT', 'Plugin installation changed');
    for (const component of current.components)
      if (component.kind === 'skill') skills.assertRemovable(component.referenceId);
    previous = repository.savePlugin(
      { ...current, enabled: false, revision: current.revision + 1 },
      current.revision,
    );
    try {
      const status = await lstat(root);
      if (!status.isDirectory() || status.isSymbolicLink() || (await realpath(root)) !== root)
        throw new PluginError('PLUGIN_OWNER', 'Plugin Skill root changed');
      await rename(root, backup);
      moved = true;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await rename(staging, root);
    published = true;
    await syncSkillDirectory(directory);
    const catalog = new SkillCatalog({
      snapshotDirectory: join(options.profileDirectory, 'skill-versions'),
    });
    const discovered = await catalog.discover(
      [{ path: root, scope: 'plugin', pluginId: plugin.id, workspaceId: null, managed: false }],
      signal,
    );
    const components: PluginComponent[] = current.components.filter(
      (entry) => entry.kind === 'app',
    );
    for (const name of manifest.skills) {
      const skill = discovered.find((entry) => entry.name === name);
      if (skill === undefined)
        throw new PluginError('PLUGIN_RESOURCE', 'Updated Skill was not discovered');
      const old = current.components.find(
        (entry) => entry.kind === 'skill' && entry.id === `skill:${name}`,
      );
      components.push({
        id: `skill:${name}`,
        kind: 'skill',
        enabled: plugin.enabled && (old?.enabled ?? true),
        referenceId: skill.id,
      });
    }
    signal.throwIfAborted();
    repository.savePlugin(
      { ...current, components, revision: previous.revision + 1 },
      previous.revision,
    );
    committed = true;
  } catch (error: unknown) {
    if (!committed && previous !== undefined) {
      if (published) await rm(root, { recursive: true });
      if (moved) await rename(backup, root);
      await syncSkillDirectory(directory);
      repository.savePlugin({ ...plugin, revision: previous.revision + 1 }, previous.revision);
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (committed) await rm(backup, { recursive: true, force: true });
  }
}
