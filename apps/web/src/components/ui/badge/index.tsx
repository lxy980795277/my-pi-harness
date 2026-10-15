import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium leading-none',
  {
    variants: {
      variant: {
        secondary: 'border-border bg-secondary text-secondary-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        error: 'border-transparent bg-error text-error-foreground',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

/** Compact label using paired semantic background and foreground colors. */
export const Badge: FC<BadgeProps> = ({ className, variant, ...props }) => {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
};
