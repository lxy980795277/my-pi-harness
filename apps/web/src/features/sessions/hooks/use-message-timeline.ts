import type { MessageTimelineState } from '@/features/sessions/types/session';
import type { MessageView, ToolCallView } from '@my-pi-harness/protocol';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { buildTimelineEntries } from '@/features/sessions/utils/timeline-entries';

/** Virtual measurements own only numeric layout variables, never user-provided CSS. */
export const useMessageTimeline = (
  messages: MessageView[],
  tools: ToolCallView[],
): MessageTimelineState => {
  const entries = useMemo(() => {
    return buildTimelineEntries(messages, tools);
  }, [messages, tools]);
  const scrollElement = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: (): HTMLDivElement | null => {
      return scrollElement.current;
    },
    getItemKey: (index): string | number => {
      return entries[index]?.id ?? index;
    },
    estimateSize: (): number => {
      return 200;
    },
    overscan: 5,
  });
  useEffect(() => {
    if (followEnd.current && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
    }
  }, [entries, virtualizer]);
  const jump = useCallback((): void => {
    followEnd.current = true;
    setShowJump(false);
    if (entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
    }
  }, [entries.length, virtualizer]);
  const scroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    const nearEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    followEnd.current = nearEnd;
    setShowJump(!nearEnd);
  }, []);
  const totalSize = virtualizer.getTotalSize();
  const measureList = useCallback(
    (node: HTMLDivElement | null): void => {
      node?.style.setProperty('--list-height', `${totalSize}px`);
    },
    [totalSize],
  );
  const rows = virtualizer.getVirtualItems().flatMap((item) => {
    const entry = entries[item.index];
    if (!entry) {
      return [];
    }
    const measure = (node: HTMLDivElement | null): void => {
      node?.style.setProperty('--item-top', `${item.start}px`);
      virtualizer.measureElement(node);
    };
    return [{ key: item.key, index: item.index, entry, measure }];
  });
  return { scrollElement, showJump, jump, scroll, measureList, rows };
};
