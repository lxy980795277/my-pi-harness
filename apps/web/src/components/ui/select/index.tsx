import * as SelectPrimitive from '@radix-ui/react-select';
import type { ComponentProps, FC } from 'react';

/** Controlled shadcn select root, shared by dialog and chat controls. */
export const Select: FC<ComponentProps<typeof SelectPrimitive.Root>> = (props) => {
  return <SelectPrimitive.Root {...props} />;
};
