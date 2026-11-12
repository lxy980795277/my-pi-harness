import type { TimelineEntry } from '@/features/sessions/types/session';
import type { TimelineMessageLocation } from '@/features/sessions/types/timeline-target';

/** Source bodies map to stable virtual entries, including messages hidden inside a completed process. */
export const timelineMessageLocation = (
  entries: readonly TimelineEntry[],
  messageId: string,
): TimelineMessageLocation | null => {
  for (const [index, entry] of entries.entries()) {
    if (entry.type === 'message' && entry.part !== 'thinking' && entry.message.id === messageId) {
      return { index, processInputId: null };
    }
    if (
      entry.type === 'process' &&
      entry.entries.some((content) => {
        return (
          content.type === 'message' &&
          content.part !== 'thinking' &&
          content.message.id === messageId
        );
      })
    )
      return { index, processInputId: entry.inputId };
  }
  return null;
};
