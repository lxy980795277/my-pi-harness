import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import type { Action } from '@/types/events';

interface ConversationFooterProps {
  contextLabel?: string;
  conversationCount?: number;
  onContext?: Action;
}

/** Keeps accepted-turn counts and context availability visible below the composer. */
export const ConversationFooter: FC<ConversationFooterProps> = ({
  contextLabel = '上下文 —',
  conversationCount = 0,
  onContext,
}) => {
  return (
    <div
      className="flex h-6 items-center justify-center gap-2 text-[11px] text-muted-foreground"
      role="group"
      aria-label="对话统计"
    >
      {onContext !== undefined && (
        <Button
          type="button"
          variant="ghost"
          className="h-6 px-0 text-[11px] font-normal hover:bg-transparent"
          onClick={onContext}
          aria-label="上下文与工作状态"
        >
          {contextLabel}
        </Button>
      )}
      {onContext === undefined && <span>{contextLabel}</span>}
      <span aria-hidden>|</span>
      <span>总对话 {conversationCount} 次</span>
    </div>
  );
};
