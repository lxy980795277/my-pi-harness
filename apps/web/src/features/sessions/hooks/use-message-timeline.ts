import type { MessageTimelineState } from '@/features/sessions/types/session';
import type { MessageView, RunView, ToolCallView } from '@my-pi-harness/protocol';
import { useVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { buildTimelineEntries } from '@/features/sessions/utils/timeline-entries';
import { estimateTimelineEntry } from '@/features/sessions/utils/timeline-layout';

type TimelineAnchor = NonNullable<VirtualizerOptions<HTMLDivElement, HTMLDivElement>['anchorTo']>;
type TimelineScrollMode = 'follow' | 'read' | 'process';

/** Virtualize measured rows and follow the end only while the reader has not scrolled away. */
export const useMessageTimeline = (
  messages: MessageView[],
  tools: ToolCallView[],
  activeRunId: string | null,
  runs: RunView[],
  branchId: string,
): MessageTimelineState => {
  const entries = useMemo(() => {
    return buildTimelineEntries(messages, tools, activeRunId, runs, branchId);
  }, [activeRunId, messages, tools, runs, branchId]);
  const scrollElement = useRef<HTMLDivElement>(null);
  const contentElement = useRef<HTMLDivElement>(null);
  const scrollModeRef = useRef<TimelineScrollMode>('follow');
  const lastScrollTop = useRef(0);
  const [scrollMode, setScrollModeState] = useState<TimelineScrollMode>('follow');
  const setScrollMode = useCallback((mode: TimelineScrollMode): void => {
    scrollModeRef.current = mode;
    setScrollModeState(mode);
  }, []);
  const showJump = scrollMode !== 'follow';
  const getItemKey = useCallback(
    (index: number): string | number => {
      const entry = entries[index];
      if (entry === undefined) return index;
      return entry.id;
    },
    [entries],
  );
  const estimateSize = useCallback(
    (index: number): number => {
      const entry = entries[index];
      if (entry === undefined) return 120;
      return estimateTimelineEntry(entry);
    },
    [entries],
  );
  const follow = useCallback((): void => {
    const element = scrollElement.current;
    if (element === null || scrollModeRef.current !== 'follow') {
      return;
    }
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
  }, []);
  let anchorTo: TimelineAnchor = 'end';
  if (scrollMode === 'process') anchorTo = 'start';
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: entries.length,
    getScrollElement: () => {
      return scrollElement.current;
    },
    getItemKey,
    estimateSize,
    initialRect: { width: 1, height: 1 },
    overscan: 5,
    paddingStart: 24,
    paddingEnd: 8,
    anchorTo,
    scrollEndThreshold: 4,
    directDomUpdates: true,
  });
  const measureList = useCallback(
    (node: HTMLDivElement | null): void => {
      virtualizer.containerRef(node);
    },
    [virtualizer],
  );
  useLayoutEffect(() => {
    const viewport = scrollElement.current;
    const content = contentElement.current;
    if (viewport === null || content === null) {
      return;
    }
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(viewport);
    follow();
    return (): void => {
      observer.disconnect();
    };
  }, [follow]);
  useLayoutEffect(follow, [entries, follow]);
  const beforeProcessToggle = useCallback((): void => {
    setScrollMode('process');
    const viewport = scrollElement.current;
    if (viewport !== null) lastScrollTop.current = viewport.scrollTop;
  }, [setScrollMode]);
  const jump = useCallback((): void => {
    setScrollMode('follow');
    follow();
  }, [follow, setScrollMode]);
  const scroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      const element = event.currentTarget;
      const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= 4;
      const moved = Math.abs(element.scrollTop - lastScrollTop.current) > 1;
      lastScrollTop.current = element.scrollTop;
      if (atEnd && (moved || scrollModeRef.current === 'follow')) {
        setScrollMode('follow');
      } else if (moved) {
        setScrollMode('read');
      }
    },
    [setScrollMode],
  );
  const rows = virtualizer.getVirtualItems().flatMap((item) => {
    const entry = entries[item.index];
    if (entry === undefined) return [];
    return [{ index: item.index, entry }];
  });
  return {
    scrollElement,
    contentElement,
    empty: entries.length === 0,
    rows,
    measureList,
    measureRow: virtualizer.measureElement,
    showJump,
    beforeProcessToggle,
    jump,
    scroll,
  };
};
