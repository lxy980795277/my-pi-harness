import type { FC } from 'react';
import { Notice } from '@/components/ui/notice';
import { AttachmentPreview } from '@/features/attachments/components/attachment-preview';
import { useAttachmentContent } from '@/features/attachments/hooks/use-attachment-content';

/** Mounts original-content subscriptions only for an open preview, including loading and errors. */
export const AttachmentContent: FC<{ id: string }> = ({ id }) => {
  const content = useAttachmentContent(id);
  return (
    <>
      {content.isPending && <Notice>正在加载附件…</Notice>}
      {content.isError && <Notice tone="error">{content.error.message}</Notice>}
      {content.data && <AttachmentPreview content={content.data} />}
    </>
  );
};
