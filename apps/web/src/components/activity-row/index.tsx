import type { ComponentProps, FC } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

type ActivityRowProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'>;

/** Shared quiet trigger styling for tool and reasoning disclosures, including native summaries. */
export const ActivityRow: FC<ActivityRowProps> = ({ className, ...props }) => {
  return (
    <Button
      variant="ghost"
      {...props}
      className={cn(
        'flex h-8 w-full min-w-0 cursor-pointer items-center justify-start gap-2 border-0 px-0 text-xs font-normal text-muted-foreground/80 transition-none hover:bg-transparent focus-visible:bg-muted/50 focus-visible:outline-none disabled:opacity-100',
        className,
      )}
    />
  );
};
