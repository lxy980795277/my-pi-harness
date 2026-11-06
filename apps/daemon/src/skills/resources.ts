import { BUILTIN_PLUGIN_SKILL_RESOURCES } from '@my-pi-harness/plugins';
import { DOCUMENT_VIEW_RESOURCE_DIRECTORY, type SkillResourceSources } from '@my-pi-harness/tools';

/** Only these exact bundled files may satisfy shared Skill dependencies. */
export const BUNDLED_SKILL_RESOURCES: SkillResourceSources = {
  ...BUILTIN_PLUGIN_SKILL_RESOURCES,
  'utils/document-view/pdf_safety.py': {
    directory: DOCUMENT_VIEW_RESOURCE_DIRECTORY,
    path: 'pdf_safety.py',
  },
};
