import type { FC } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearchStore } from '@/features/search/stores/search';

/** Opens a search overlay while the current conversation and its drafts remain mounted. */
export const SearchEntry: FC = () => {
  const open = useSearchStore((state) => {
    return state.show;
  });
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 w-full justify-start gap-3 rounded-2xl px-3 text-sm"
      onClick={open}
    >
      <Search width={18} height={18} aria-hidden />
      搜索记忆与对话
    </Button>
  );
};
