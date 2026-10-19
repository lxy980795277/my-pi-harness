import type { AttachmentPreviewState } from '@/features/attachments/types/attachment';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAttachment } from '@/features/attachments/services/attachments';

/** Owns the preview dialog and persistent metadata; original content has a dialog-scoped owner. */
export const useAttachmentPreview = (id: string): AttachmentPreviewState => {
  const [open, setOpen] = useState(false);
  const metadata = useQuery({
    queryKey: ['attachment', id],
    queryFn: ({ signal }) => {
      return fetchAttachment(id, signal);
    },
  });
  const show = useCallback((): void => {
    setOpen(true);
  }, []);
  return { open, setOpen, show, metadata };
};
