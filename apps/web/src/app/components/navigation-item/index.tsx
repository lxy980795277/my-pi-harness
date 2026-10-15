import type { LucideIcon } from 'lucide-react';
import type { FC } from 'react';

import type { WorkspacePage } from '@/app/stores/workspace';
import { Button } from '@/components/ui/button';
import { useNavigationItem } from '@/app/hooks/use-navigation-item';

interface NavigationItemProps {
  page: WorkspacePage;
  activePage: WorkspacePage;
  label: string;
  icon: LucideIcon;
  onNavigate: (page: WorkspacePage) => void;
}

/** Accessible navigation keeps the actual selection visible to keyboard and screen-reader users. */
export const NavigationItem: FC<NavigationItemProps> = ({
  page,
  activePage,
  label,
  icon: Icon,
  onNavigate,
}) => {
  const { current, className, select } = useNavigationItem(page, activePage, onNavigate);
  return (
    <Button
      variant="ghost"
      type="button"
      className={className}
      aria-current={current}
      onClick={select}
    >
      <Icon width={14} height={14} aria-hidden />
      {label}
    </Button>
  );
};
