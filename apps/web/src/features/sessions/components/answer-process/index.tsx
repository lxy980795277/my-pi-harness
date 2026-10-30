import type { ApprovalMode, EditInput, ToolDecisionInput } from '@my-pi-harness/protocol';
import { ChevronRight } from 'lucide-react';
import { memo, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { TimelineContent } from '@/features/sessions/components/timeline-content';
import { useAnswerProcess } from '@/features/sessions/hooks/use-answer-process';
import type { TimelineProcessEntry } from '@/features/sessions/types/session';
import { cn } from '@/utils/cn';

interface AnswerProcessProps {
  entry: TimelineProcessEntry;
  workspaceId: string | null;
  approvalMode: ApprovalMode;
  canEdit: boolean;
  onBeforeToggle: () => void;
  onEdit: (input: EditInput) => Promise<void>;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Closed processes unmount their contents; the virtual row measures the resulting natural height. */
export const AnswerProcess: FC<AnswerProcessProps> = memo(
  ({ entry, workspaceId, approvalMode, canEdit, onBeforeToggle, onEdit, onDecide }) => {
    const state = useAnswerProcess(entry.sessionId, entry.inputId, onBeforeToggle);
    return (
      <div className="min-w-0" aria-label="回答过程">
        <div className="border-b border-border/50">
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-1 border-0 px-0 text-xs font-normal text-muted-foreground/80 transition-none hover:bg-transparent"
            aria-label={state.actionLabel}
            aria-expanded={state.expanded}
            aria-controls={state.contentId}
            onClick={state.toggle}
          >
            <span>已处理</span>
            <span>{entry.durationLabel}</span>
            <ChevronRight
              width={14}
              height={14}
              className={cn(state.expanded && 'rotate-90')}
              aria-hidden
            />
          </Button>
        </div>
        {state.expanded && (
          <section id={state.contentId} aria-label="回答过程详情" className="min-w-0 py-2">
            {entry.entries.map((content) => {
              return (
                <TimelineContent
                  key={content.id}
                  entry={content}
                  workspaceId={workspaceId}
                  approvalMode={approvalMode}
                  canEdit={canEdit}
                  onEdit={onEdit}
                  onDecide={onDecide}
                />
              );
            })}
          </section>
        )}
      </div>
    );
  },
);
