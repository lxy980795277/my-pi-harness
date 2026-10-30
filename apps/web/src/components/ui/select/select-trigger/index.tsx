import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Select trigger owns the combobox label and keyboard interaction. */
export const SelectTrigger: FC<ComponentProps<typeof SelectPrimitive.Trigger>> = ({
  className,
  children,
  ...props
}) => {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          width={14}
          height={14}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
};
