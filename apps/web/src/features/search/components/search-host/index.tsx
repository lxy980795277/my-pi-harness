import type { FC } from 'react';
import { SearchDialog } from '@/features/search/components/search-dialog';
import { useSearchStore } from '@/features/search/stores/search';

/** Private search state mounts only inside the authorized application shell. */
export const SearchHost: FC = () => {
  const open = useSearchStore((state) => {
    return state.open;
  });
  if (!open) return null;
  return <SearchDialog />;
};
