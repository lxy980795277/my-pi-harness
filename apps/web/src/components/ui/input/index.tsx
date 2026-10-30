import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Text input primitive with consistent focus, invalid and disabled states. */
export const Input: FC<ComponentProps<'input'>> = ({ className, ...props }) => {
  return (
    <input
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error-foreground',
        className,
      )}
      {...props}
    />
  );
};
