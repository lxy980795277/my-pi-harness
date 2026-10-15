import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps, FC } from 'react';
import { cn } from '@/utils/cn';

/** Floating panels remain above dialog content and within the available viewport. */
export const PopoverContent: FC<ComponentProps<typeof PopoverPrimitive.Content>> = ({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 8,
  ...props
}) => {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-[80] max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
};
