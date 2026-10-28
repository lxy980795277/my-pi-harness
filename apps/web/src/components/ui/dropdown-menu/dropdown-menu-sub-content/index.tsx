import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';
import { cn } from '@/utils/cn';

/** Portaled submenus may flip at the viewport edge without clipping their parent. */
export const DropdownMenuSubContent: FC<ComponentProps<typeof MenuPrimitive.SubContent>> = ({
  className,
  sideOffset = 6,
  alignOffset = -6,
  ...props
}) => {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn(
          'z-[81] max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-border bg-card p-1.5 text-card-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
};
