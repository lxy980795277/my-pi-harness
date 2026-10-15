import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded border text-xs font-medium transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border-border bg-background text-foreground hover:bg-accent',
        ghost: 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-accent',
        destructive: 'border-transparent bg-error text-error-foreground hover:opacity-90',
      },
      size: {
        default: 'h-8 px-3',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

/** shadcn-style button primitive with keyboard-visible focus and typed variants. */
export const Button: FC<ButtonProps> = ({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) => {
  let Component: typeof Slot | 'button' = 'button';
  if (asChild) {
    Component = Slot;
  }

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
};
