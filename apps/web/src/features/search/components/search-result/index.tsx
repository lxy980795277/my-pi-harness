import type { SearchHit } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { BookOpen, GitBranch, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { searchOriginLabel } from '@/features/search/utils/search';
import { SourceWorkspace } from '@/features/search/components/source-workspace';
import type { ValueChange } from '@/types/events';

interface SearchResultProps {
  hit: SearchHit;
  onOpen: ValueChange<SearchHit>;
}
const TIME = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Source identity stays distinct even when different messages contain identical text. */
export const SearchResult: FC<SearchResultProps> = ({ hit, onOpen }) => {
  const open = (): void => {
    onOpen(hit);
  };
  return (
    <div className="space-y-2 rounded-xl border border-border px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full items-start justify-start gap-3 px-0 py-0 text-left"
        onClick={open}
      >
        {hit.origin === 'memory' && (
          <BookOpen
            width={15}
            height={15}
            className="mt-1 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        {(hit.origin === 'task' || hit.origin === 'communication') && (
          <GitBranch
            width={15}
            height={15}
            className="mt-1 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        {(hit.origin === 'user' || hit.origin === 'assistant') && (
          <MessageCircle
            width={15}
            height={15}
            className="mt-1 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-medium [overflow-wrap:anywhere]">{hit.title}</span>
          <span className="line-clamp-3 block text-xs leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {hit.text}
          </span>
        </span>
      </Button>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 pl-6 text-[11px] text-muted-foreground">
        <span>
          {searchOriginLabel(hit.origin)} · {TIME.format(hit.createdAt)} · {hit.status}
        </span>
        <SourceWorkspace workspaceId={hit.workspaceId} />
      </div>
    </div>
  );
};
