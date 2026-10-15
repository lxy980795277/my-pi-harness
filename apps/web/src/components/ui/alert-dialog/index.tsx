import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { FC } from 'react';

import { useDialogFocus } from '@/components/ui/dialog/use-dialog-focus';
import { Notice } from '@/components/ui/notice';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  error?: string | null;
}

/** Destructive confirmation keeps focus and Escape behavior inside a real alertdialog. */
export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  error,
}) => {
  const focus = useDialogFocus(undefined, undefined);
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-foreground/20" />
        <AlertDialogPrimitive.Content
          onOpenAutoFocus={focus.open}
          onCloseAutoFocus={focus.close}
          className="fixed top-1/2 left-1/2 z-[70] w-[calc(100%_-_3rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl bg-card p-6 text-card-foreground shadow-xl"
        >
          <AlertDialogPrimitive.Title className="text-base font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-xs leading-6 text-muted-foreground">
            {description}
          </AlertDialogPrimitive.Description>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                取消
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
};
