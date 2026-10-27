import { createHash } from 'node:crypto';
import { readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readSkillTree, SkillCatalog, SkillError } from '@my-pi-harness/integrations';
import type { PluginManifest } from '@my-pi-harness/protocol';
import type { StoredPlugin } from '@my-pi-harness/storage';

/** Installed copies belong exclusively to a plugin; user and project roots are never traversed. */
export async function installedPluginDirectory(
  plugin: StoredPlugin,
  profileDirectory: string,
): Promise<string> {
  const directory = resolve(profileDirectory, 'plugins', plugin.id);
  if (resolve(plugin.directory) !== directory || (await realpath(directory)) !== directory)
    throw new SkillError('PLUGIN_OWNER', 'Plugin installation directory changed');
  return directory;
}

async function treeDigest(directory: string, signal: AbortSignal): Promise<string> {
  const files = await readSkillTree(directory, signal);
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(JSON.stringify([file.path, file.content.length]));
    digest.update(file.content);
  }
  return digest.digest('hex');
}

/** Content comparison includes referenced resources; unchanged starts preserve authorization epochs. */
export async function pluginSkillsCurrent(
  plugin: StoredPlugin,
  manifest: PluginManifest,
  profileDirectory: string,
  resourceDirectory: string,
  signal: AbortSignal,
): Promise<boolean> {
  const directory = await installedPluginDirectory(plugin, profileDirectory);
  const names = plugin.components
    .filter((component) => component.kind === 'skill')
    .map((entry) => entry.id);
  if (
    JSON.stringify(names.slice().sort()) !==
    JSON.stringify(manifest.skills.map((name) => `skill:${name}`).sort())
  )
    return false;
  const root = join(directory, 'skills');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink()))
      throw new SkillError('PLUGIN_OWNER', 'Plugin Skill root contains an unowned entry');
    if (
      JSON.stringify(entries.map((entry) => entry.name).sort()) !==
      JSON.stringify(manifest.skills.slice().sort())
    )
      return false;
    for (const name of manifest.skills) {
      signal.throwIfAborted();
      const installed = await treeDigest(join(root, name), signal);
      const bundled = await treeDigest(join(resourceDirectory, plugin.id, 'skills', name), signal);
      if (installed !== bundled) return false;
    }
    const catalog = new SkillCatalog({
      snapshotDirectory: join(profileDirectory, 'skill-versions'),
    });
    const discovered = await catalog.discover(
      [{ path: root, scope: 'plugin', pluginId: plugin.id, workspaceId: null, managed: false }],
      signal,
    );
    if (
      discovered.some(
        (skill) =>
          !plugin.components.some(
            (component) =>
              component.kind === 'skill' &&
              component.id === `skill:${skill.name}` &&
              component.referenceId === skill.id,
          ),
      )
    )
      return false;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  return true;
}
