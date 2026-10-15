import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Uses a real heading so callers can name each status region. */
export const CardTitle: FC<ComponentProps<'h2'>> = ({ className, children, ...props }) => {
  return (
    <h2
      data-slot="card-title"
      className={cn('text-sm leading-none font-semibold', className)}
      {...props}
    >
      {children}
    </h2>
  );
};
