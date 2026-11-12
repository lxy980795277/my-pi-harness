import { create } from 'zustand';
import type { SearchSourceSelection } from '@my-pi-harness/protocol';
import type { SearchFilters } from '@/features/search/types/search';

interface SearchPresentationState {
  open: boolean;
  filters: SearchFilters;
  selected: SearchSourceSelection | null;
  show: () => void;
  close: () => void;
  select: (selection: SearchSourceSelection | null) => void;
  inspect: (selection: SearchSourceSelection) => void;
  change: (patch: Partial<SearchFilters>) => void;
  reset: () => void;
}

const DEFAULT_FILTERS: SearchFilters = {
  query: '',
  kind: 'message',
  workspace: 'current',
  period: 'all',
  archived: false,
  historical: false,
  tasks: false,
  userMemories: true,
  branchId: 'visible',
};

/** Filters and exact navigation intents are client state; result bodies and source windows stay in Query. */
export const useSearchStore = create<SearchPresentationState>((set) => {
  return {
    open: false,
    filters: DEFAULT_FILTERS,
    selected: null,
    show: (): void => {
      set({ open: true, selected: null });
    },
    close: (): void => {
      set({ open: false, selected: null });
    },
    select: (selected): void => {
      set({ selected });
    },
    inspect: (selected): void => {
      set({ open: true, selected });
    },
    change: (patch): void => {
      set((state) => {
        return { filters: { ...state.filters, ...patch }, selected: null };
      });
    },
    reset: (): void => {
      set({ open: false, filters: DEFAULT_FILTERS, selected: null });
    },
  };
});
