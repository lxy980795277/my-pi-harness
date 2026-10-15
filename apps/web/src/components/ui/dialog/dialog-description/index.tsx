import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Screen-reader description remains available when visually hidden. */
export const DialogDescription: FC<ComponentProps<typeof DialogPrimitive.Description>> = ({
  className,
  ...props
}) => {
  return (
    <DialogPrimitive.Description
      className={cn('text-xs leading-6 text-muted-foreground', className)}
      {...props}
    />
  );
};
