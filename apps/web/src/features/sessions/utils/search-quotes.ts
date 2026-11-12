import type { InputRequest, SearchSourceSelection } from '@my-pi-harness/protocol';
import { sourceSelectionKey } from '@/features/search/utils/search';

export const EMPTY_SEARCH_QUOTES: readonly SearchSourceSelection[] = [];

/** Empty drafts omit the optional protocol field; nonempty references are frozen with the input. */
export const searchQuoteFields = (
  quotes: readonly SearchSourceSelection[],
): Pick<InputRequest, 'searchQuotes'> => {
  if (quotes.length === 0) return {};
  return { searchQuotes: [...quotes] };
};

/** Quoting alone is still an explicit send action with a visible instruction. */
export const quotedInputText = (text: string, quotes: readonly SearchSourceSelection[]): string => {
  const draft = text.trim();
  if (draft.length === 0 && quotes.length > 0) return '请结合所选引用回答。';
  return draft;
};

/** An acknowledgement removes only the exact references frozen in that submitted input. */
export const remainingSearchQuotes = (
  current: readonly SearchSourceSelection[],
  submitted: readonly SearchSourceSelection[],
): readonly SearchSourceSelection[] => {
  const keys = new Set(submitted.map(sourceSelectionKey));
  return current.filter((selection) => {
    return !keys.has(sourceSelectionKey(selection));
  });
};
