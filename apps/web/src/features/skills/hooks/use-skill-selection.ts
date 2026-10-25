import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SkillSelection, SkillView } from '@my-pi-harness/protocol';
import { fetchSkills } from '@/features/skills/services/skills';
import type { SkillSelectionState } from '@/features/skills/types/skill';

/** Draft selection stays with its composer owner; Query owns current catalog metadata. */
export const useSkillSelection = (
  selected: SkillSelection[],
  changeSelection: (skills: SkillSelection[]) => void,
  workspaceId: string | null,
  locked: boolean,
  enabled = true,
): SkillSelectionState => {
  const [open, setOpen] = useState(false);
  const reading = enabled && (open || selected.length > 0);
  const catalog = useQuery({
    queryKey: ['skills', workspaceId],
    queryFn: ({ signal }) => {
      return fetchSkills(workspaceId, signal);
    },
    enabled: reading,
  });
  const invalid = selected.filter((selection) => {
    return !(catalog.data ?? []).some((entry) => {
      return (
        entry.id === selection.id &&
        entry.contentHash === selection.contentHash &&
        entry.enabled &&
        !entry.shadowed
      );
    });
  });
  const choose = useCallback(
    (skill: SkillView): void => {
      if (locked) return;
      if (
        selected.some((entry) => {
          return entry.id === skill.id;
        })
      ) {
        changeSelection(
          selected.filter((entry) => {
            return entry.id !== skill.id;
          }),
        );
        return;
      }
      if (skill.enabled && !skill.shadowed && selected.length < 16)
        changeSelection([...selected, { id: skill.id, contentHash: skill.contentHash }]);
    },
    [changeSelection, locked, selected],
  );
  const rows = (catalog.data ?? []).map((skill) => {
    const isSelected = selected.some((entry) => {
      return entry.id === skill.id && entry.contentHash === skill.contentHash;
    });
    return {
      skill,
      selected: isSelected,
      disabled:
        locked || (!isSelected && (!skill.enabled || skill.shadowed || selected.length >= 16)),
      change: (): void => {
        choose(skill);
      },
    };
  });
  const openPicker = useCallback((): void => {
    setOpen(true);
  }, []);
  const removeInvalid = useCallback((): void => {
    if (!locked)
      changeSelection(
        selected.filter((entry) => {
          return !invalid.includes(entry);
        }),
      );
  }, [changeSelection, invalid, locked, selected]);
  let error: string | null = null;
  if (catalog.error !== null) error = catalog.error.message;
  const loading = reading && catalog.isPending;
  return {
    selected,
    rows,
    open,
    changeOpen: setOpen,
    openPicker,
    loading,
    error,
    blocked: selected.length > 0 && (loading || error !== null || invalid.length > 0),
    invalid,
    removeInvalid,
    locked,
  };
};
