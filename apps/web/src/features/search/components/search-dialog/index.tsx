import type { FC } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Notice } from '@/components/ui/notice';
import { SearchFilters } from '@/features/search/components/search-filters';
import { SearchResult } from '@/features/search/components/search-result';
import { SourceReader } from '@/features/search/components/source-reader';
import { useSearchDialog } from '@/features/search/hooks/use-search-dialog';
import { sourceSelectionKey, selectionFromHit } from '@/features/search/utils/search';

/** A unified search and read-only source overlay keeps main-session ownership unchanged. */
export const SearchDialog: FC = () => {
  const state = useSearchDialog();
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent
        className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden"
        closeLabel="关闭搜索"
      >
        <DialogTitle>搜索记忆与对话</DialogTitle>
        <DialogDescription>
          按明确范围查找持久原文；搜索结果不会自动成为长期记忆。
        </DialogDescription>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {state.selected && (
            <SourceReader
              key={sourceSelectionKey(state.selected)}
              ownerId={state.ownerId}
              selection={state.selected}
              active={state.activeSnapshot}
              onBack={state.closeSource}
              onClose={state.close}
            />
          )}
          {!state.selected && (
            <>
              <SearchFilters state={state} />
              {state.error && <Notice tone="error">{state.error}</Notice>}
              {state.indexLabel && (
                <p className="text-xs text-muted-foreground">{state.indexLabel}</p>
              )}
              {!state.hasIntent && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  选择范围并输入内容后搜索。
                </p>
              )}
              {state.hasIntent && state.results.isFetching && <Notice>正在搜索…</Notice>}
              {state.hasIntent && state.results.isError && (
                <Notice tone="error">{state.results.error.message}</Notice>
              )}
              {state.hasIntent && !state.results.isError && state.results.data && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {state.results.data.mode === 'hybrid' && '混合检索'}
                    {state.results.data.mode === 'lexical' && '关键词检索'} ·{' '}
                    {state.results.data.hits.length} 个结果
                  </p>
                  {state.results.data.truncated && (
                    <Notice>结果或索引覆盖尚不完整，可缩小范围后重新搜索。</Notice>
                  )}
                  {state.results.data.hits.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      没有找到匹配的原文。
                    </p>
                  )}
                  {state.results.data.hits.map((hit) => {
                    return (
                      <SearchResult
                        key={sourceSelectionKey(selectionFromHit(hit))}
                        hit={hit}
                        onOpen={state.openResult}
                      />
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
