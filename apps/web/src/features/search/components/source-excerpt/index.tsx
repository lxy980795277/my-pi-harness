import type { SearchSourceExcerpt, SearchSourceSelection } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sourceOriginLabel } from '@/features/search/utils/search';
import type { ValueChange } from '@/types/events';

interface SourceExcerptProps {
  excerpt: SearchSourceExcerpt;
  onQuote: ValueChange<SearchSourceSelection>;
  disabled: boolean;
}

/** Reader text is inert, bounded original content; no editing, learning or execution controls mount here. */
export const SourceExcerpt: FC<SourceExcerptProps> = ({ excerpt, onQuote, disabled }) => {
  const quote = (): void => {
    onQuote({
      source: excerpt.source,
      target: excerpt.target,
      start: excerpt.start,
      end: excerpt.end,
    });
  };
  return (
    <article className="space-y-2 rounded-xl border border-border p-4" aria-label="只读原文片段">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {sourceOriginLabel(excerpt)} · 字符 {excerpt.start + 1}–{excerpt.end} /{' '}
          {excerpt.totalLength}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={quote}
          disabled={disabled || excerpt.text.length === 0}
        >
          <Quote width={12} height={12} aria-hidden />
          引用此片段
        </Button>
      </div>
      <p className="text-sm leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap">
        {excerpt.text}
      </p>
    </article>
  );
};
