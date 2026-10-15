import type { SessionSummary } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { useSessionNavigation } from '@/features/sessions/hooks/use-session-navigation';

interface SessionNavigationProps {
  session: SessionSummary;
  activeId: string | null;
  onSelect: (id: string) => void;
}

/** A real button keeps session navigation operable with keyboard and assistive technology. */
export const SessionNavigation: FC<SessionNavigationProps> = ({ session, activeId, onSelect }) => {
  const state = useSessionNavigation(session, activeId, onSelect);
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        onClick={state.select}
        aria-current={state.current}
        className={state.className}
      >
        <span className="min-w-0 flex-1 truncate font-normal">{session.title}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground" title={state.createdAtTitle}>
          {state.createdAtLabel}
        </span>
      </Button>
    </div>
  );
};
