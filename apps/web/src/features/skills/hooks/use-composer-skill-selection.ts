import { useCallback } from 'react';
import type { SkillSelection } from '@my-pi-harness/protocol';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useSkillSelection } from '@/features/skills/hooks/use-skill-selection';
import type { SkillSelectionState } from '@/features/skills/types/skill';

/** Stable empty selection avoids a new Zustand selector value on each render. */
export const EMPTY_SKILL_SELECTIONS: SkillSelection[] = [];
/** Frozen accepted choices override only the visible draft, leaving the next draft with its owner. */
export const useComposerSkillSelection = (
  draftKey: string,
  workspaceId: string | null,
  locked: boolean,
  frozen?: SkillSelection[],
): SkillSelectionState => {
  const stored = useComposerStore((state) => {
    return state.skillSelections[draftKey] ?? EMPTY_SKILL_SELECTIONS;
  });
  const setSelections = useComposerStore((state) => {
    return state.setSkillSelections;
  });
  const change = useCallback(
    (skills: SkillSelection[]): void => {
      setSelections(draftKey, skills);
    },
    [draftKey, setSelections],
  );
  return useSkillSelection(frozen ?? stored, change, workspaceId, locked);
};
