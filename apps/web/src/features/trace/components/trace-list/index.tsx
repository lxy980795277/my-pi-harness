import type { TraceEntry } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { TraceRow } from '@/features/trace/components/trace-row';
import { useTraceList } from '@/features/trace/hooks/use-trace-list';

interface TraceListProps {
  items: TraceEntry[];
  selectedId: string | null;
  onSelect: (entryId: string) => void;
}

/** Pagination bounds cached facts and virtualization bounds mounted row content. */
export const TraceList: FC<TraceListProps> = ({ items, selectedId, onSelect }) => {
  const state = useTraceList(items);
  return (
    <div
      ref={state.scrollElement}
      className="min-h-0 flex-1 overflow-y-auto px-2"
      aria-label="执行事件"
    >
      <div ref={state.measureList} className="relative w-full">
        {state.rows.map(({ entry, index }) => {
          return (
            <div
              key={entry.id}
              data-index={index}
              ref={state.measureRow}
              className="absolute top-0 left-0 w-full"
            >
              <TraceRow entry={entry} selected={entry.id === selectedId} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
