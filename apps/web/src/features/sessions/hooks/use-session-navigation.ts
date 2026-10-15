import type { SessionNavigationState } from '@/features/sessions/types/session-view';
import { useCallback } from 'react';
import type { SessionSummary } from '@my-pi-harness/protocol';
import {
  describeSessionCreatedAt,
  formatSessionCreatedAt,
} from '@/features/workspaces/utils/workspace-tree';
import { cn } from '@/utils/cn';

/** Session ids are bound outside the view's JSX event attributes. */
export const useSessionNavigation = (
  session: SessionSummary,
  activeId: string | null,
  onSelect: (id: string) => void,
): SessionNavigationState => {
  const id = session.id;
  const select = useCallback((): void => {
    onSelect(id);
  }, [id, onSelect]);
  let current: 'page' | undefined;
  let activeClass = 'hover:bg-muted';
  if (id === activeId) {
    current = 'page';
    activeClass = 'bg-secondary text-secondary-foreground';
  }
  return {
    select,
    current,
    className: cn(
      'h-8 w-full justify-start gap-2 rounded-lg pr-2 pl-8 text-left text-xs',
      activeClass,
    ),
    createdAtLabel: formatSessionCreatedAt(session.createdAt, Date.now()),
    createdAtTitle: describeSessionCreatedAt(session.createdAt),
  };
};
