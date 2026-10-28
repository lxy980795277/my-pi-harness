import { Atom, ChevronRight } from 'lucide-react';
import { memo, type FC } from 'react';
import { Markdown } from '@/components/markdown';
import { reasoningPreview } from '@/features/sessions/utils/reasoning-preview';

interface MessageThinkingProps {
  text: string;
  streaming: boolean;
}

/** Render reasoning independently of message editing and answer actions. */
export const MessageThinking: FC<MessageThinkingProps> = memo(({ text, streaming }) => {
  return (
    <details className="group/thinking min-w-0 text-muted-foreground">
      <summary
        className="group/reasoning flex w-full min-w-0 cursor-pointer list-none items-center gap-2 rounded py-1 text-sm focus-visible:bg-muted/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        aria-label="思考内容"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <Atom
            width={15}
            height={15}
            className="group-hover/thinking:hidden group-focus-visible/reasoning:hidden"
            aria-hidden
          />
          <ChevronRight
            width={15}
            height={15}
            className="hidden group-open/thinking:rotate-90 group-hover/thinking:block group-focus-visible/reasoning:block"
            aria-hidden
          />
        </span>
        <span className="shrink-0">思考</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">{reasoningPreview(text)}</span>
      </summary>
      <div className="mt-2 rounded-lg bg-muted/40 px-4 py-3">
        <Markdown text={text} streaming={streaming} className="text-sm" />
      </div>
    </details>
  );
});
