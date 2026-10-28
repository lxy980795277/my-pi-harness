import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';
import { cn } from '@/utils/cn';

/** Portaled menus use the available viewport height and the shared semantic surface. */
export const DropdownMenuContent: FC<ComponentProps<typeof MenuPrimitive.Content>> = ({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}) => {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-[80] max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-border bg-card p-1.5 text-card-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
};
