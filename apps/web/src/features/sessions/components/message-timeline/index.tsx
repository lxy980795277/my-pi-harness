import type {
  ApprovalMode,
  EditInput,
  MessageView,
  RunView,
  ToolCallView,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import type { FC, ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';
import { LoadingDots } from '@/components/loading-dots';
import { RequestFailure } from '@/components/request-failure';
import { Button } from '@/components/ui/button';
import { AnswerFooter } from '@/features/sessions/components/answer-footer';
import { AnswerProcess } from '@/features/sessions/components/answer-process';
import { TimelineContent } from '@/features/sessions/components/timeline-content';
import { useMessageTimeline } from '@/features/sessions/hooks/use-message-timeline';
import { cn } from '@/utils/cn';

interface MessageTimelineProps {
  workspaceId: string | null;
  approvalMode: ApprovalMode;
  messages: MessageView[];
  tools: ToolCallView[];
  runs: RunView[];
  branchId: string;
  activeRunId: string | null;
  canEdit: boolean;
  onEdit: (input: EditInput) => Promise<void>;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
  children?: ReactNode;
}

/** Render the visible measured rows and overscan while keeping the complete history scrollable. */
export const MessageTimeline: FC<MessageTimelineProps> = ({
  workspaceId,
  approvalMode,
  messages,
  tools,
  runs,
  branchId,
  activeRunId,
  canEdit,
  onEdit,
  onDecide,
  children,
}) => {
  const state = useMessageTimeline(messages, tools, activeRunId, runs, branchId);
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={state.scrollElement}
        className="h-full overflow-x-hidden overflow-y-auto px-5 [overflow-anchor:none] sm:px-6"
        aria-label="对话记录"
        onScroll={state.scroll}
      >
        <div ref={state.contentElement} className="mx-auto w-full max-w-4xl">
          <div className={cn('relative', state.empty && 'min-h-48')} ref={state.measureList}>
            {state.empty && (
              <div className="flex h-full min-h-48 items-center justify-center text-xs text-muted-foreground">
                发送第一条消息，开始这个会话。
              </div>
            )}
            {state.rows.map(({ entry, index }) => {
              return (
                <div
                  key={entry.id}
                  data-index={index}
                  ref={state.measureRow}
                  className={cn('absolute top-0 left-0 w-full')}
                >
                  {(entry.type === 'message' || entry.type === 'tool') && (
                    <TimelineContent
                      entry={entry}
                      workspaceId={workspaceId}
                      approvalMode={approvalMode}
                      canEdit={canEdit}
                      onEdit={onEdit}
                      onDecide={onDecide}
                    />
                  )}
                  {entry.type === 'process' && (
                    <AnswerProcess
                      entry={entry}
                      workspaceId={workspaceId}
                      approvalMode={approvalMode}
                      canEdit={canEdit}
                      onBeforeToggle={state.beforeProcessToggle}
                      onEdit={onEdit}
                      onDecide={onDecide}
                    />
                  )}
                  {entry.type === 'answer-footer' && <AnswerFooter footer={entry.footer} />}
                  {entry.type === 'request-error' && (
                    <article className="min-w-0" aria-label="Agent的消息">
                      <RequestFailure text={entry.text} />
                    </article>
                  )}
                  {entry.type === 'waiting' && (
                    <div
                      className="flex min-h-8 items-center gap-2 py-1 text-sm text-muted-foreground"
                      role="status"
                      aria-label="正在等待响应"
                    >
                      <LoadingDots />
                      <span className="sr-only">正在等待响应</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {children}
        </div>
      </div>
      {state.showJump && (
        <Button
          type="button"
          variant="outline"
          className="absolute bottom-3 left-1/2 h-8 -translate-x-1/2 gap-1.5 rounded-full bg-card px-3 text-card-foreground shadow-sm"
          onClick={state.jump}
        >
          <ArrowDown width={14} height={14} aria-hidden />
          回到最新消息
        </Button>
      )}
    </div>
  );
};
