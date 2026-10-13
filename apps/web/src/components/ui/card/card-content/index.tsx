import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn.js';

export const CardContent: FC<ComponentProps<'div'>> = ({ className, ...props }) => {
  return <div data-slot="card-content" className={cn('px-4 pb-4', className)} {...props} />;
};
