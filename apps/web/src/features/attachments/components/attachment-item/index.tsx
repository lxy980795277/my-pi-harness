import { Paperclip, X } from 'lucide-react';
import { useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { AttachmentContent } from '@/features/attachments/components/attachment-content';
import { useAttachmentPreview } from '@/features/attachments/hooks/use-attachment-preview';

interface AttachmentItemProps {
  id: string;
  onRemove?: (id: string) => void;
  disabled?: boolean;
}
/** Metadata chips remain readable in draft, queue and historical messages. */
export const AttachmentItem: FC<AttachmentItemProps> = ({ id, onRemove, disabled = false }) => {
  const state = useAttachmentPreview(id);
  const remove = useCallback((): void => {
    onRemove?.(id);
  }, [id, onRemove]);
  const name = state.metadata.data?.name ?? '附件';
  return (
    <>
      <div className="inline-flex max-w-full items-center rounded-lg border border-border bg-muted/40">
        <Button
          type="button"
          variant="ghost"
          className="h-8 min-w-0 gap-1.5 px-2 text-xs"
          onClick={state.show}
          aria-label={`预览附件 ${name}`}
        >
          <Paperclip width={13} height={13} className="shrink-0" aria-hidden />
          <span className="max-w-44 truncate">{name}</span>
        </Button>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={remove}
            disabled={disabled}
            aria-label={`移除附件 ${name}`}
          >
            <X width={12} height={12} aria-hidden />
          </Button>
        )}
      </div>
      <Dialog open={state.open} onOpenChange={state.setOpen}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogTitle className="pr-8">{name}</DialogTitle>
          {state.metadata.data?.sourcePath && (
            <div className="text-xs break-words text-muted-foreground">
              {state.metadata.data.sourcePath}
            </div>
          )}
          {state.open && <AttachmentContent id={id} />}
        </DialogContent>
      </Dialog>
      {state.metadata.isError && (
        <span className="text-xs text-error-foreground">{state.metadata.error.message}</span>
      )}
    </>
  );
};
