import { GitBranch } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { useSessionTaskEntry } from '@/features/tasks/hooks/use-session-task-entry';

interface SessionTaskEntryProps {
  sessionId: string;
}

/** Pending child requests remain discoverable while their transcript panel is closed. */
export const SessionTaskEntry: FC<SessionTaskEntryProps> = ({ sessionId }) => {
  const state = useSessionTaskEntry(sessionId);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={state.show}
      className="h-8 gap-1.5 rounded-full px-2 text-xs"
      aria-label="打开会话任务"
    >
      <GitBranch width={14} height={14} aria-hidden />
      <span>任务 {state.count}</span>
      {state.pending > 0 && (
        <span className="rounded-full bg-muted px-1.5 text-warning-solid">
          待确认 {state.pending}
        </span>
      )}
    </Button>
  );
};
