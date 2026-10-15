import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Keyboard-operable shadcn switch with a single controlled checked state. */
export const Switch: FC<ComponentProps<typeof SwitchPrimitive.Root>> = ({
  className,
  ...props
}) => {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-secondary transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-1 rounded-full bg-card shadow-sm transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
};
