import type { SearchQueryResult } from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNavigationStore } from '../src/app/stores/navigation';
import { useSearchDialog } from '../src/features/search/hooks/use-search-dialog';
import { useSearchStore } from '../src/features/search/stores/search';
import type { SearchDialogState } from '../src/features/search/types/search';
import { SEARCH_RESULTS } from './fixtures/search';

afterEach(() => {
  useNavigationStore.getState().reset();
  useSearchStore.getState().reset();
});

describe('search overlay request ownership', () => {
  it('closing cancels owned reads and removes late results without clearing a subsequently opened owner', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let state: SearchDialogState | undefined;
    const Probe: FC = () => {
      state = useSearchDialog();
      return null;
    };
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
    if (state === undefined) throw new Error('Search owner did not render');
    const dialog = state;
    let release: ((data: SearchQueryResult) => void) | undefined;
    const late = new Promise<SearchQueryResult>((resolve) => {
      release = resolve;
    });
    let readSignal: AbortSignal | undefined;
    const key = ['search-results', dialog.ownerId, 'query'];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: ({ signal }) => {
        readSignal = signal;
        return late;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      client.setQueryData(['search-results', 'different-owner', 'query'], SEARCH_RESULTS);
      dialog.close();
      await vi.waitFor(() =>
        expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined(),
      );
      expect(readSignal?.aborted).toBe(true);
      expect(client.getQueryData(['search-results', 'different-owner', 'query'])).toEqual(
        SEARCH_RESULTS,
      );
      release?.(SEARCH_RESULTS);
      await late;
      expect(client.getQueryData(key)).toBeUndefined();
    } finally {
      unsubscribe();
      release?.(SEARCH_RESULTS);
      client.clear();
    }
  });
});
