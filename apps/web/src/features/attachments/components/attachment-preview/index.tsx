import type { AttachmentContent } from '@my-pi-harness/protocol';
import type { FC } from 'react';

interface AttachmentPreviewProps {
  content: AttachmentContent;
}
/** Images and extracted text are rendered as inert content, without raw HTML execution. */
export const AttachmentPreview: FC<AttachmentPreviewProps> = ({ content }) => {
  return (
    <div className="min-h-20 min-w-0">
      {content.imageData && (
        <img
          src={`data:${content.attachment.mediaType};base64,${content.imageData}`}
          alt={content.attachment.name}
          className="mx-auto max-h-[60svh] max-w-full rounded-lg object-contain"
        />
      )}
      {content.text !== null && (
        <div className="max-h-[60svh] overflow-y-auto rounded-lg bg-muted p-3 text-xs leading-6 break-words whitespace-pre-wrap">
          {content.text}
        </div>
      )}
      {content.text === null && !content.imageData && (
        <div className="text-sm text-muted-foreground">没有可预览的内容。</div>
      )}
    </div>
  );
};
