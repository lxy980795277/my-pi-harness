import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';

/** Menu root delegates dismissal, focus and keyboard navigation to Radix. */
export const DropdownMenu: FC<ComponentProps<typeof MenuPrimitive.Root>> = (props) => {
  return <MenuPrimitive.Root {...props} />;
};
