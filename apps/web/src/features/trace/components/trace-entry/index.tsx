import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { Activity } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { TraceDialog } from '@/features/trace/components/trace-dialog';
import { useTraceEntry } from '@/features/trace/hooks/use-trace-dialog';

interface TraceEntryProps {
  snapshot: SessionSnapshot;
}

/** Execution history opens on demand without changing the active conversation branch. */
export const SessionTraceEntry: FC<TraceEntryProps> = ({ snapshot }) => {
  const state = useTraceEntry(snapshot.session.id, snapshot.session.activeBranchId);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-8 gap-1.5 rounded-full px-2 text-xs"
        onClick={state.show}
        aria-label="打开执行轨迹"
      >
        <Activity width={14} height={14} aria-hidden />
        <span>轨迹</span>
      </Button>
      {state.open && <TraceDialog key={snapshot.session.id} snapshot={snapshot} />}
    </>
  );
};
