import type { SkillsPort } from '@my-pi-harness/agent-runtime';
import type { SkillsService } from './service.js';

/** Adapt frozen Skill resources into model content without granting execution permissions. */
export function createSkillsPort(skills: SkillsService): SkillsPort {
  return {
    list: (workspaceId, signal) => skills.list(workspaceId, signal),
    freezeSelections: (workspaceId, selections, signal) =>
      skills.freezeSelections(workspaceId, selections, signal),
    validateBindings: (frozen, signal) => skills.validateBindings(frozen, signal),
    assertBindingsCurrent: (frozen) => skills.assertBindingsCurrent(frozen),
    retainBindings: (frozen) => skills.retainBindings(frozen),
    async loadResource(skill, path, signal) {
      const content = await skills.loadResource(skill, path, signal);
      const identity = {
        type: 'text' as const,
        text: JSON.stringify({ skill: skill.selection, path: content.path, hash: content.hash }),
      };
      if (content.type === 'image')
        return [identity, { type: 'image', data: content.data, mimeType: content.mimeType }];
      return [identity, { type: 'text', text: content.text }];
    },
  };
}
