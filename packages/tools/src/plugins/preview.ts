import { join } from 'node:path';
import type { PluginSkillPreview } from '@my-pi-harness/protocol';
import { PluginError } from './errors.js';
import { checkedSkillDirectory, readSkillFile } from '../skills/files.js';
import { parseSkill } from '../skills/parser.js';
import { BUILTIN_PLUGINS, BUILTIN_PLUGIN_RESOURCE_DIRECTORY } from './catalog.js';

/** Reads only manifest-owned SKILL.md files; no snapshot, installation or external request occurs. */
export async function previewBuiltinPluginSkills(
  pluginId: string,
  signal: AbortSignal,
  resourceDirectory = BUILTIN_PLUGIN_RESOURCE_DIRECTORY,
): Promise<PluginSkillPreview[]> {
  signal.throwIfAborted();
  const manifest = BUILTIN_PLUGINS.find((entry) => entry.id === pluginId);
  if (manifest === undefined) throw new PluginError('PLUGIN_NOT_FOUND', 'Unknown built-in plugin');
  return await previewPluginSkills(
    join(resourceDirectory, manifest.id, 'skills'),
    manifest.skills,
    signal,
  );
}

/** Reads the exact installed or bundled instruction directories selected by their owning plugin. */
export async function previewPluginSkills(
  skillsDirectory: string,
  names: readonly string[],
  signal: AbortSignal,
): Promise<PluginSkillPreview[]> {
  const output: PluginSkillPreview[] = [];
  for (const name of names) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
      throw new PluginError('PLUGIN_RESOURCE', 'Plugin Skill name is invalid');
    const root = await checkedSkillDirectory(join(skillsDirectory, name));
    const bytes = await readSkillFile(root, 'SKILL.md', signal);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new PluginError('PLUGIN_RESOURCE', 'Bundled Skill must contain valid UTF-8', { cause });
    }
    const parsed = parseSkill(text, name);
    output.push({ name: parsed.name, description: parsed.description, content: parsed.content });
  }
  signal.throwIfAborted();
  return output;
}
