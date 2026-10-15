import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Accessible dialog heading shared by settings and nested editors. */
export const DialogTitle: FC<ComponentProps<typeof DialogPrimitive.Title>> = ({
  className,
  ...props
}) => {
  return (
    <DialogPrimitive.Title
      className={cn('pr-8 text-lg font-semibold tracking-tight', className)}
      {...props}
    />
  );
};
