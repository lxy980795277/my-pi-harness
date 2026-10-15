import type { NavigationItemState } from '@/app/types/application-view';
import { useCallback } from 'react';
import type { WorkspacePage } from '@/app/stores/workspace';
import { cn } from '@/utils/cn';

/** Navigation adapters expose a synchronous click and semantic current-page state. */
export const useNavigationItem = (
  page: WorkspacePage,
  activePage: WorkspacePage,
  onNavigate: (page: WorkspacePage) => void,
): NavigationItemState => {
  let current: 'page' | undefined;
  let activeClass = 'text-muted-foreground hover:bg-accent';
  if (page === activePage) {
    current = 'page';
    activeClass = 'bg-background text-foreground shadow-sm';
  }
  const select = useCallback((): void => {
    onNavigate(page);
  }, [onNavigate, page]);
  return {
    current,
    select,
    className: cn('flex h-10 w-full justify-start gap-3 rounded-xl px-3 text-sm', activeClass),
  };
};
