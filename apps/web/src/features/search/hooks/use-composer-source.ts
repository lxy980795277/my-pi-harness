import type { SearchSourceSelection } from '@my-pi-harness/protocol';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { fetchSearchSource } from '@/features/search/services/search';
import { useSearchStore } from '@/features/search/stores/search';
import { sourceSelectionKey } from '@/features/search/utils/search';
import { quotedSourceText } from '@/features/search/utils/source-text';
import type { ValueChange } from '@/types/events';
import type { ComposerSourceState } from '@/features/search/types/search';

/** Composer locators resolve through Query; no quoted source body becomes a client draft fact. */
export const useComposerSource = (
  selection: SearchSourceSelection,
  locked: boolean,
  onRemove: ValueChange<string>,
): ComposerSourceState => {
  const inspect = useSearchStore((state) => {
    return state.inspect;
  });
  const query = useQuery({
    queryKey: ['quote-source', selection],
    meta: { memorySource: selection.source.kind === 'memory' },
    queryFn: ({ signal }) => {
      return fetchSearchSource({ selection, before: 0, after: 0 }, signal);
    },
  });
  let title = '正在读取引用…';
  let text: string | null = null;
  if (query.data !== undefined && !query.isFetching && !query.isError) {
    title = query.data.title;
    text = quotedSourceText(query.data, selection);
  }
  if (query.isError) title = '引用来源已变化或不可用';
  const open = useCallback((): void => {
    inspect(selection);
  }, [inspect, selection]);
  const remove = useCallback((): void => {
    if (!locked) onRemove(sourceSelectionKey(selection));
  }, [locked, onRemove, selection]);
  return { title, text, open, remove };
};
