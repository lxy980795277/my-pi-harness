import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps, FC } from 'react';

/** Controlled shadcn tabs provide roving keyboard focus and tabpanel association. */
export const Tabs: FC<ComponentProps<typeof TabsPrimitive.Root>> = (props) => {
  return <TabsPrimitive.Root {...props} />;
};
