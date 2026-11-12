import type { SearchSourceSelection } from '@my-pi-harness/protocol';
import { useCallback } from 'react';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { EMPTY_SEARCH_QUOTES } from '@/features/sessions/utils/search-quotes';
import type { ComposerQuoteState } from '@/features/sessions/types/composer';

/** Unknown inputs retain their frozen references; fresh drafts own only removable source locators. */
export const useComposerQuotes = (
  draftKey: string,
  locked: boolean,
  frozen?: readonly SearchSourceSelection[],
): ComposerQuoteState => {
  const stored = useComposerStore((state) => {
    return state.searchQuotes[draftKey] ?? EMPTY_SEARCH_QUOTES;
  });
  const remove = useComposerStore((state) => {
    return state.removeSearchQuote;
  });
  let searchQuotes = stored;
  if (locked) searchQuotes = frozen ?? EMPTY_SEARCH_QUOTES;
  const removeSearchQuote = useCallback(
    (key: string): void => {
      if (!locked) remove(draftKey, key);
    },
    [draftKey, locked, remove],
  );
  return { searchQuotes, removeSearchQuote };
};
