import type { SkillResourceContent, SkillView } from '@my-pi-harness/protocol';
import type { SkillResourcePreview } from '@/features/skills/types/skill';

/** Resource content belongs to the exact displayed Skill version and workspace. */
export const selectedSkillResource = (
  preview: SkillResourcePreview | null,
  skill: SkillView | undefined,
  workspaceId: string | null,
): SkillResourceContent | null => {
  if (
    preview === null ||
    skill === undefined ||
    preview.skillId !== skill.id ||
    preview.contentHash !== skill.contentHash ||
    preview.workspaceId !== workspaceId
  ) {
    return null;
  }
  return preview.resource;
};
