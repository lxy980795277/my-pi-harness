import type { FrozenSkill, SkillCandidate } from '@my-pi-harness/protocol/internal';

/** Candidate fixtures retain accepted identities without leaking instruction bodies into metadata. */
export function skillCandidate(skill: FrozenSkill): SkillCandidate {
  return {
    selection: skill.selection,
    authorization: skill.authorization,
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
    source: skill.source,
  };
}
