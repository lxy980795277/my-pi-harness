import { Clock3, Database } from 'lucide-react';
import type { FC } from 'react';
import type { AnswerMetadata as AnswerMetadataFields } from '@/features/sessions/types/answer-metadata';

interface AnswerMetadataProps {
  metadata: AnswerMetadataFields;
}

/** Quiet usage, elapsed time and timestamp share the answer's existing action row. */
export const AnswerMetadata: FC<AnswerMetadataProps> = ({ metadata }) => {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="回答统计"
    >
      <span className="inline-flex items-center gap-1.5" title={metadata.tokensTitle}>
        <Database width={13} height={13} aria-hidden />
        {metadata.tokensLabel}
      </span>
      <span className="inline-flex items-center gap-1.5" title={metadata.durationTitle}>
        <Clock3 width={13} height={13} aria-hidden />
        {metadata.durationLabel}
      </span>
      <time dateTime={metadata.dateTime} title={metadata.timeTitle}>
        {metadata.timeLabel}
      </time>
    </div>
  );
};
