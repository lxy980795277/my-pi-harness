import type { WorkspaceIcon } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent } from 'react';
import {
  filterWorkspaceIcons,
  type WorkspaceIconOption,
} from '@/components/workspace-icon/workspace-icons';

interface WorkspaceIconPickerState {
  open: boolean;
  query: string;
  options: readonly WorkspaceIconOption[];
  changeOpen: (open: boolean) => void;
  changeQuery: (event: ChangeEvent<HTMLInputElement>) => void;
  select: (icon: WorkspaceIcon) => void;
  reset: () => void;
}

/** A selection closes its panel without changing the workspace's separate form draft. */
export const useWorkspaceIconPicker = (
  onChange: (icon: WorkspaceIcon) => void,
): WorkspaceIconPickerState => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const changeOpen = useCallback((next: boolean): void => {
    setOpen(next);
    if (!next) {
      setQuery('');
    }
  }, []);
  const changeQuery = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
  }, []);
  const select = useCallback(
    (icon: WorkspaceIcon): void => {
      onChange(icon);
      changeOpen(false);
    },
    [changeOpen, onChange],
  );
  const reset = useCallback((): void => {
    select('folder');
  }, [select]);
  return {
    open,
    query,
    options: filterWorkspaceIcons(query),
    changeOpen,
    changeQuery,
    select,
    reset,
  };
};
