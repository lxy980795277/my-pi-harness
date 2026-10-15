import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps, FC } from 'react';

/** Controlled, modal shadcn dialog root with Radix focus and keyboard ownership. */
export const Dialog: FC<ComponentProps<typeof DialogPrimitive.Root>> = (props) => {
  return <DialogPrimitive.Root {...props} />;
};
