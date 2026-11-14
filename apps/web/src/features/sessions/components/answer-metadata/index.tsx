import { Clock3, Database } from 'lucide-react';
import type { FC } from 'react';
import type { AnswerTimestamp } from '@/features/sessions/types/answer-metadata';
import { useAnswerUsage } from '@/features/usage/hooks/use-answer-usage';

interface AnswerMetadataProps {
  sessionId: string;
  inputId: string;
  timestamp: AnswerTimestamp;
}

/** Quiet usage, elapsed time and timestamp share the answer's existing action row. */
export const AnswerMetadata: FC<AnswerMetadataProps> = ({ sessionId, inputId, timestamp }) => {
  const usage = useAnswerUsage(sessionId, inputId);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="回答统计"
    >
      <span className="inline-flex items-center gap-1.5" title={usage.tokensTitle}>
        <Database width={13} height={13} aria-hidden />
        {usage.tokensLabel}
      </span>
      <span className="inline-flex items-center gap-1.5" title={usage.durationTitle}>
        <Clock3 width={13} height={13} aria-hidden />
        {usage.durationLabel}
      </span>
      <time dateTime={timestamp.dateTime} title={timestamp.timeTitle}>
        {timestamp.timeLabel}
      </time>
    </div>
  );
};
