import type { SkillResourceContent, SkillView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { selectedSkillResource } from '../src/features/skills/utils/skill-resource-preview';
import type { SkillResourcePreview } from '../src/features/skills/types/skill';

const SKILL: SkillView = {
  id: 'skill-a',
  name: 'skill-a',
  description: 'Fixture Skill',
  scope: 'user',
  pluginId: null,
  workspaceId: null,
  contentHash: 'a'.repeat(64),
  enabled: true,
  shadowed: false,
  managed: true,
  resourceCount: 1,
  source: 'fixture',
};
const TEXT: SkillResourceContent = {
  type: 'text',
  text: 'Resource A',
  path: 'reference.md',
  hash: 'b'.repeat(64),
};
const PREVIEW: SkillResourcePreview = {
  skillId: SKILL.id,
  contentHash: SKILL.contentHash,
  workspaceId: null,
  resource: TEXT,
};

describe('Skill resource preview ownership', () => {
  it('keeps the exact resource content visible for its displayed Skill version', () => {
    expect(selectedSkillResource(PREVIEW, SKILL, null)).toBe(TEXT);
    const image: SkillResourceContent = {
      type: 'image',
      data: 'YQ==',
      mimeType: 'image/png',
      path: 'image.png',
      hash: 'c'.repeat(64),
    };
    expect(selectedSkillResource({ ...PREVIEW, resource: image }, SKILL, null)).toBe(image);
  });

  it('hides a completed or late resource from the previous Skill, scope or content version', () => {
    expect(selectedSkillResource(PREVIEW, { ...SKILL, id: 'skill-b' }, null)).toBeNull();
    expect(selectedSkillResource(PREVIEW, SKILL, 'workspace')).toBeNull();
    expect(
      selectedSkillResource(PREVIEW, { ...SKILL, contentHash: 'd'.repeat(64) }, null),
    ).toBeNull();
    expect(selectedSkillResource(PREVIEW, undefined, null)).toBeNull();
    expect(selectedSkillResource(null, SKILL, null)).toBeNull();
  });
});
