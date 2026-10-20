import type { TimelineEntry } from '@/features/sessions/types/session';

/** Estimate unmounted rows only; the virtualizer replaces estimates with measured heights. */
export const estimateTimelineEntry = (entry: TimelineEntry): number => {
  if (entry.type === 'tool') {
    return 44;
  }
  if (entry.type === 'waiting' || entry.type === 'answer-footer') {
    return 56;
  }
  const text = entry.message.text;
  let lines = 0;
  for (const line of text.split('\n')) {
    lines += Math.max(1, Math.ceil(line.length / 80));
  }
  return Math.max(120, Math.min(1600, lines * 28 + 80));
};
