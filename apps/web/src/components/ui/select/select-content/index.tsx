import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';
import { getStyleNonce } from '@/utils/style-nonce';

/** Portal content follows its trigger width while keeping a bounded scrolling viewport. */
export const SelectContent: FC<ComponentProps<typeof SelectPrimitive.Content>> = ({
  className,
  children,
  position = 'popper',
  ...props
}) => {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'relative z-[70] max-h-80 min-w-32 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1">
          <ChevronUp width={14} height={14} aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          nonce={getStyleNonce()}
          className="min-w-[var(--radix-select-trigger-width)] p-1"
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1">
          <ChevronDown width={14} height={14} aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
};
