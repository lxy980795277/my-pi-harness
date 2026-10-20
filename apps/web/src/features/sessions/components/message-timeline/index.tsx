import type {
  EditInput,
  MessageView,
  RunView,
  ToolCallView,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { ArrowDown, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageCard } from '@/features/sessions/components/message-card';
import { AnswerFooter } from '@/features/sessions/components/answer-footer';
import { useMessageTimeline } from '@/features/sessions/hooks/use-message-timeline';
import { ToolCard } from '@/features/sessions/components/tool-card';
import { cn } from '@/utils/cn';

interface MessageTimelineProps {
  messages: MessageView[];
  tools: ToolCallView[];
  runs: RunView[];
  branchId: string;
  activeRunId: string | null;
  canEdit: boolean;
  onEdit: (input: EditInput) => Promise<void>;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Render the visible measured rows and overscan while keeping the complete history scrollable. */
export const MessageTimeline: FC<MessageTimelineProps> = ({
  messages,
  tools,
  runs,
  branchId,
  activeRunId,
  canEdit,
  onEdit,
  onDecide,
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
        <div
          className={cn('relative mx-auto w-full max-w-4xl', state.empty && 'min-h-48')}
          ref={state.measureList}
        >
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
                className={cn('absolute top-0 left-0 w-full pb-2', entry.type === 'tool' && 'pb-1')}
              >
                {entry.type === 'message' && (
                  <MessageCard message={entry.message} canEdit={canEdit} onEdit={onEdit} />
                )}
                {entry.type === 'tool' && <ToolCard tool={entry.tool} onDecide={onDecide} />}
                {entry.type === 'answer-footer' && <AnswerFooter footer={entry.footer} />}
                {entry.type === 'waiting' && (
                  <div
                    className="flex min-h-8 items-center gap-2 py-1 text-sm text-muted-foreground"
                    role="status"
                    aria-label="正在等待响应"
                  >
                    <LoaderCircle
                      width={14}
                      height={14}
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                    正在等待响应…
                  </div>
                )}
              </div>
            );
          })}
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
