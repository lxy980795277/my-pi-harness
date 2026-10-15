import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, FC } from 'react';

import { Button } from '@/components/ui/button';
import { useDialogFocus } from '@/components/ui/dialog/use-dialog-focus';
import { cn } from '@/utils/cn';

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string };

/** Portal content traps focus and restores it to the opener after a controlled close. */
export const DialogContent: FC<DialogContentProps> = ({
  className,
  children,
  closeLabel = '关闭',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}) => {
  const focus = useDialogFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-0 z-40 bg-foreground/20" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100svh-3rem)] w-[calc(100%_-_3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl bg-card p-6 text-card-foreground shadow-xl outline-none',
          className,
        )}
        {...props}
        onOpenAutoFocus={focus.open}
        onCloseAutoFocus={focus.close}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-3 right-3 z-20 rounded-full"
            aria-label={closeLabel}
          >
            <X width={16} height={16} aria-hidden />
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
};
