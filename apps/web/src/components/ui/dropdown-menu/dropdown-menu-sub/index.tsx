import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';

/** Submenus preserve the parent's dismissal and keyboard-navigation behavior. */
export const DropdownMenuSub: FC<ComponentProps<typeof MenuPrimitive.Sub>> = (props) => {
  return <MenuPrimitive.Sub {...props} />;
};
