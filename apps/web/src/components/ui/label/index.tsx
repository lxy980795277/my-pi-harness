import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Form label primitive keeps control association and shared typography. */
export const Label: FC<ComponentProps<typeof LabelPrimitive.Root>> = ({ className, ...props }) => {
  return <LabelPrimitive.Root className={cn('text-xs font-medium', className)} {...props} />;
};
