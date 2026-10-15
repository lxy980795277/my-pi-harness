import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Tabs list supports horizontal authentication and vertical settings navigation. */
export const TabsList: FC<ComponentProps<typeof TabsPrimitive.List>> = ({
  className,
  ...props
}) => {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center gap-1 rounded-xl bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
};
