import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn.js';

export const CardHeader: FC<ComponentProps<'div'>> = ({ className, ...props }) => {
  return <div data-slot="card-header" className={cn('p-4', className)} {...props} />;
};
