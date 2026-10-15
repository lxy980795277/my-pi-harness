import * as SelectPrimitive from '@radix-ui/react-select';
import type { ComponentProps, FC } from 'react';

/** Placeholder is represented by SelectValue rather than an empty selectable item. */
export const SelectValue: FC<ComponentProps<typeof SelectPrimitive.Value>> = (props) => {
  return <SelectPrimitive.Value {...props} />;
};
