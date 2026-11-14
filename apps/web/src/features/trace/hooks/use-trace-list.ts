import { useVirtualizer } from '@tanstack/react-virtual';
import type { TraceEntry } from '@my-pi-harness/protocol';
import { useCallback, useRef, type RefObject } from 'react';

interface TraceListState {
  scrollElement: RefObject<HTMLDivElement | null>;
  rows: { index: number; entry: TraceEntry }[];
  measureList: (node: HTMLDivElement | null) => void;
  measureRow: (node: HTMLDivElement | null) => void;
}

/** The virtualizer owns numeric row transforms and total height under the shared CSP policy. */
export const useTraceList = (items: readonly TraceEntry[]): TraceListState => {
  const scrollElement = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback(
    (index: number): string | number => {
      return items[index]?.id ?? index;
    },
    [items],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => {
      return scrollElement.current;
    },
    getItemKey,
    estimateSize: () => {
      return 78;
    },
    initialRect: { width: 1, height: 1 },
    overscan: 4,
    directDomUpdates: true,
  });
  const measureList = useCallback(
    (node: HTMLDivElement | null): void => {
      virtualizer.containerRef(node);
    },
    [virtualizer],
  );
  const rows = virtualizer.getVirtualItems().flatMap((item) => {
    const entry = items[item.index];
    if (entry === undefined) return [];
    return [{ index: item.index, entry }];
  });
  return { scrollElement, rows, measureList, measureRow: virtualizer.measureElement };
};
