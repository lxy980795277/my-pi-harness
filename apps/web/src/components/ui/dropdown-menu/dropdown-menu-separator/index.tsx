import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';
import { cn } from '@/utils/cn';

/** Separates menu sections without introducing another focusable item. */
export const DropdownMenuSeparator: FC<ComponentProps<typeof MenuPrimitive.Separator>> = ({
  className,
  ...props
}) => {
  return (
    <MenuPrimitive.Separator className={cn('mx-1 my-1.5 h-px bg-border', className)} {...props} />
  );
};
