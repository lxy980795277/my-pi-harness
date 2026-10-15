import type {
  EditInput,
  MessageView,
  ToolCallView,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCard } from '@/features/sessions/components/message-card';
import { useMessageTimeline } from '@/features/sessions/hooks/use-message-timeline';
import { ToolCard } from '@/features/sessions/components/tool-card';

interface MessageTimelineProps {
  messages: MessageView[];
  tools: ToolCallView[];
  canEdit: boolean;
  onEdit: (input: EditInput) => Promise<void>;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Only visible measured rows render, while manual scroll position is respected during streaming. */
export const MessageTimeline: FC<MessageTimelineProps> = ({
  messages,
  tools,
  canEdit,
  onEdit,
  onDecide,
}) => {
  const state = useMessageTimeline(messages, tools);
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={state.scrollElement}
        className="h-full overflow-y-auto px-4 py-4"
        aria-label="对话记录"
        onScroll={state.scroll}
      >
        {messages.length === 0 && tools.length === 0 && (
          <div className="flex h-full min-h-48 items-center justify-center text-xs text-muted-foreground">
            发送第一条消息，开始这个会话。
          </div>
        )}
        {(messages.length > 0 || tools.length > 0) && (
          <div
            className="relative mx-auto h-[var(--list-height)] w-full max-w-4xl"
            ref={state.measureList}
          >
            {state.rows.map((row) => {
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  className="absolute top-[var(--item-top)] left-0 w-full pb-4"
                  ref={row.measure}
                >
                  {row.entry.type === 'message' && (
                    <MessageCard message={row.entry.message} canEdit={canEdit} onEdit={onEdit} />
                  )}
                  {row.entry.type === 'tool' && (
                    <ToolCard tool={row.entry.tool} onDecide={onDecide} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {state.showJump && (
        <Button
          type="button"
          variant="outline"
          className="absolute right-5 bottom-3 shadow-sm"
          onClick={state.jump}
        >
          回到最新消息
        </Button>
      )}
    </div>
  );
};
