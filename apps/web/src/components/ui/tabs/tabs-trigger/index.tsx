import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Tab trigger uses native button semantics and visible focus. */
export const TabsTrigger: FC<ComponentProps<typeof TabsPrimitive.Trigger>> = ({
  className,
  ...props
}) => {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-card-foreground data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
};
