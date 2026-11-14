import type { TraceEntry } from '@my-pi-harness/protocol';
import { Brain, Cpu, ShieldCheck, Wrench, type LucideIcon } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { traceDuration, traceStatusLabel, traceTime } from '@/features/trace/utils/trace-view';
import { cn } from '@/utils/cn';

interface TraceRowProps {
  entry: TraceEntry;
  selected: boolean;
  onSelect: (entryId: string) => void;
}

const ICONS: Record<TraceEntry['kind'], LucideIcon> = {
  request: Cpu,
  tool: Wrench,
  approval: ShieldCheck,
  compaction: Brain,
};

/** Each row shows bounded host facts; its input and output remain a separate read. */
export const TraceRow: FC<TraceRowProps> = ({ entry, selected, onSelect }) => {
  const Icon = ICONS[entry.kind] ?? Cpu;
  const select = (): void => {
    onSelect(entry.id);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'my-1 h-auto w-full min-w-0 justify-start gap-3 rounded-xl px-3 py-3 text-left font-normal',
        selected && 'bg-muted',
      )}
      onClick={select}
      aria-current={selected && 'true'}
    >
      <Icon width={16} height={16} aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xs font-medium">{entry.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {traceTime(entry.at)} · {traceDuration(entry.durationMs)}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-[11px] text-muted-foreground',
          entry.status === 'failed' && 'text-destructive',
        )}
      >
        {traceStatusLabel(entry.status)}
      </span>
    </Button>
  );
};
