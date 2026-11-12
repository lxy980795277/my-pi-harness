import type { SearchSourceSelection } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Quote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComposerSource } from '@/features/search/hooks/use-composer-source';
import type { ValueChange } from '@/types/events';

interface ComposerSourceProps {
  selection: SearchSourceSelection;
  locked: boolean;
  onRemove: ValueChange<string>;
}

/** Quoted fragments remain inspectable and removable before an explicit send. */
export const ComposerSource: FC<ComposerSourceProps> = ({ selection, locked, onRemove }) => {
  const state = useComposerSource(selection, locked, onRemove);
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl border border-border bg-muted/40 p-2">
      <Quote width={13} height={13} className="mt-1 shrink-0 text-muted-foreground" aria-hidden />
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-w-0 flex-1 flex-col items-start gap-1 px-1 py-0 text-left"
        onClick={state.open}
      >
        <span className="max-w-full truncate text-xs">{state.title}</span>
        {state.text && (
          <span className="line-clamp-2 text-[11px] leading-5 [overflow-wrap:anywhere] text-muted-foreground">
            {state.text}
          </span>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={state.remove}
        disabled={locked}
        aria-label="移除这条引用"
      >
        <X width={12} height={12} aria-hidden />
      </Button>
    </div>
  );
};
