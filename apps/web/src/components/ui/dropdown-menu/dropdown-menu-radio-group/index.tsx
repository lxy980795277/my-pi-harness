import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, FC } from 'react';

/** Single-choice menu state remains controlled by its domain owner. */
export const DropdownMenuRadioGroup: FC<ComponentProps<typeof MenuPrimitive.RadioGroup>> = (
  props,
) => {
  return <MenuPrimitive.RadioGroup {...props} />;
};
