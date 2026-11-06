import type { SkillResourceSources } from '@my-pi-harness/tools/skills';
import { BUNDLED_PLUGIN_RESOURCE_DIRECTORY } from './plugins/catalog';

/** Shared plugin scripts are explicit, version-pinned sources for generic Skill snapshots. */
export const BUILTIN_PLUGIN_SKILL_RESOURCES: SkillResourceSources = Object.fromEntries(
  ['common.py', 'cli_support.py', 'convert_pdf.py'].map((name) => {
    const path = `plugins/shared/office/${name}`;
    return [path, { directory: BUNDLED_PLUGIN_RESOURCE_DIRECTORY, path }];
  }),
);
