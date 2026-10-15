import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps, FC } from 'react';

/** asChild preserves the shared button's accessible name and disabled behavior. */
export const PopoverTrigger: FC<ComponentProps<typeof PopoverPrimitive.Trigger>> = (props) => {
  return <PopoverPrimitive.Trigger {...props} />;
};
