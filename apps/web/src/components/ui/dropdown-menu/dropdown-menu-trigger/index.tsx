import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';

/** A child button retains the menu's focus and expanded-state semantics. */
export const DropdownMenuTrigger: FC<ComponentProps<typeof MenuPrimitive.Trigger>> = (props) => {
  return <MenuPrimitive.Trigger {...props} />;
};
