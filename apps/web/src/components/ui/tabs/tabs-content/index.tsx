import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Content is associated with its tab and unmounted when inactive unless explicitly retained. */
export const TabsContent: FC<ComponentProps<typeof TabsPrimitive.Content>> = ({
  className,
  ...props
}) => {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
};
