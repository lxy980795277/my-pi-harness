import { Atom, ChevronRight } from 'lucide-react';
import { memo, type FC } from 'react';
import { ActivityRow } from '@/components/activity-row';
import { Markdown } from '@/components/markdown';
import { reasoningPreview } from './preview';

interface MessageThinkingProps {
  text: string;
  streaming: boolean;
}

/** Render reasoning independently of message editing and answer actions. */
export const MessageThinking: FC<MessageThinkingProps> = memo(({ text, streaming }) => {
  return (
    <details className="group/thinking min-w-0">
      <ActivityRow asChild className="group/reasoning list-none [&::-webkit-details-marker]:hidden">
        <summary aria-label="思考内容">
          <span className="relative h-3.5 w-3.5 shrink-0" aria-hidden>
            <Atom
              width={14}
              height={14}
              className="absolute inset-0 group-hover/reasoning:hidden group-focus-visible/reasoning:hidden"
            />
            <ChevronRight
              width={14}
              height={14}
              className="absolute inset-0 hidden group-open/thinking:rotate-90 group-hover/reasoning:block group-focus-visible/reasoning:block"
            />
          </span>
          <span className="shrink-0">思考</span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate text-left">{reasoningPreview(text)}</span>
        </summary>
      </ActivityRow>
      <div className="mt-1 ml-6 min-w-0 space-y-3 rounded-xl bg-muted/50 px-3 py-3">
        <Markdown text={text} streaming={streaming} className="text-sm" />
      </div>
    </details>
  );
});
