import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps, FC } from 'react';

/** Controlled popover root owns dismissal and keyboard focus through Radix. */
export const Popover: FC<ComponentProps<typeof PopoverPrimitive.Root>> = (props) => {
  return <PopoverPrimitive.Root {...props} />;
};
