import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';
import { cn } from '@/utils/cn';

/** A keyboard-selectable menu action closes its owning menu through the Radix item lifecycle. */
export const DropdownMenuItem: FC<ComponentProps<typeof MenuPrimitive.Item>> = ({
  className,
  children,
  ...props
}) => {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex min-h-9 cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </MenuPrimitive.Item>
  );
};
