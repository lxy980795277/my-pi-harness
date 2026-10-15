import type { FC } from 'react';
import { AttachmentItem } from '@/features/attachments/components/attachment-item';

interface AttachmentListProps {
  ids: string[];
  onRemove?: (id: string) => void;
  disabled?: boolean;
}
/** Shares the same persisted attachment preview between composers and history. */
export const AttachmentList: FC<AttachmentListProps> = ({ ids, onRemove, disabled }) => {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="附件列表">
      {ids.map((id) => {
        return (
          <AttachmentItem
            key={id}
            id={id}
            {...(onRemove && { onRemove })}
            {...(disabled !== undefined && { disabled })}
          />
        );
      })}
    </div>
  );
};
