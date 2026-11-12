import type {
  MemoryCategoryFilter,
  MemoryManagerView,
  MemoryModeFilter,
  MemoryPagination,
} from '@/features/memory/types/memory';

const FIRST_PAGE: readonly (string | null)[] = [null];

/** A cursor belongs to one scope and mode filter; navigation changes never reuse another list's page. */
export const memoryPageKey = (
  scopeKey: string,
  mode: MemoryModeFilter,
  view: MemoryManagerView = 'entries',
  category: MemoryCategoryFilter = 'all',
): string => {
  return JSON.stringify([scopeKey, mode, view, category]);
};

/** External workspace changes start at the first page before any new response can be rendered. */
export const memoryPageCursors = (
  pagination: MemoryPagination,
  key: string,
): readonly (string | null)[] => {
  if (pagination.key === key) return pagination.cursors;
  return FIRST_PAGE;
};
