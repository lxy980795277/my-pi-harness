import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn.js';

export { CardContent } from './card-content/index.js';
export { CardHeader } from './card-header/index.js';
export { CardTitle } from './card-title/index.js';

/** Neutral surface primitive shared by status and diagnostic panels. */
export const Card: FC<ComponentProps<'section'>> = ({ className, ...props }) => {
  return (
    <section
      data-slot="card"
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  );
};
