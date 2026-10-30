import type { ComponentProps, FC } from 'react';

import { cn } from '@/utils/cn';

/** Multiline input primitive used for drafts and explicit configuration text. */
export const Textarea: FC<ComponentProps<'textarea'>> = ({ className, ...props }) => {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 resize-y rounded border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error-foreground',
        className,
      )}
      {...props}
    />
  );
};
