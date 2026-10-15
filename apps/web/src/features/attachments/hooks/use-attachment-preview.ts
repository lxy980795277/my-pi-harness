import type { AttachmentPreviewState } from '@/features/attachments/types/attachment-view';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAttachment,
  fetchAttachmentContent,
} from '@/features/attachments/services/attachments';

/** Original bytes are queried only while open and removed from cache after closing. */
export const useAttachmentPreview = (id: string): AttachmentPreviewState => {
  const [open, setOpen] = useState(false);
  const metadata = useQuery({
    queryKey: ['attachment', id],
    queryFn: ({ signal }) => {
      return fetchAttachment(id, signal);
    },
  });
  const content = useQuery({
    queryKey: ['attachment-content', id],
    queryFn: ({ signal }) => {
      return fetchAttachmentContent(id, signal);
    },
    enabled: open,
    gcTime: 0,
  });
  const show = useCallback((): void => {
    setOpen(true);
  }, []);
  return { open, setOpen, show, metadata, content };
};
