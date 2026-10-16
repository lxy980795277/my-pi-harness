import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';
import { getStyleNonce } from '@/utils/style-nonce';

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  horizontal?: boolean;
  viewportClassName?: string;
};

/** Scrollable primitive exposes a viewport while retaining visible scrollbar affordances. */
export const ScrollArea: FC<ScrollAreaProps> = ({
  className,
  children,
  horizontal = false,
  viewportClassName,
  ...props
}) => {
  let orientation: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>['orientation'] = 'vertical';
  if (horizontal) {
    orientation = 'horizontal';
  }
  return (
    <ScrollAreaPrimitive.Root
      className={cn('relative min-h-0 overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        nonce={getStyleNonce()}
        className={cn('size-full rounded-[inherit]', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation={orientation}
        className="flex touch-none p-0.5 transition-colors select-none data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
};
