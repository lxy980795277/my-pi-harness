import { join } from 'node:path';
import type { PluginSkillPreview } from '@my-pi-harness/protocol';
import { SkillError } from '../skills/errors.js';
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
  if (manifest === undefined) throw new SkillError('PLUGIN_NOT_FOUND', 'Unknown built-in plugin');
  const output: PluginSkillPreview[] = [];
  for (const name of manifest.skills) {
    const root = await checkedSkillDirectory(join(resourceDirectory, manifest.id, 'skills', name));
    const bytes = await readSkillFile(root, 'SKILL.md', signal);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new SkillError('PLUGIN_RESOURCE', 'Bundled Skill must contain valid UTF-8', { cause });
    }
    const parsed = parseSkill(text, name);
    output.push({ name: parsed.name, description: parsed.description, content: parsed.content });
  }
  signal.throwIfAborted();
  return output;
}
