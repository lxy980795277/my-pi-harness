import type { FC } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SearchModelResource } from '@/features/search/components/search-model-resource';
import { useSearchResources } from '@/features/search/hooks/use-search-resources';

/** Explicit local resource controls stay in settings and never gate the conversation composer. */
export const SearchResourcesPanel: FC = () => {
  const state = useSearchResources();
  return (
    <section
      className="space-y-4 border-t border-border pt-5"
      aria-labelledby="search-resources-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="search-resources-heading" className="text-sm font-semibold">
          本地搜索
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={state.refresh}
          disabled={state.command.pending}
          aria-label="刷新搜索资源状态"
          title="刷新状态"
        >
          <RefreshCw width={14} height={14} aria-hidden />
        </Button>
      </div>
      {state.model.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取语义模型状态…
        </p>
      )}
      {state.model.isError && <Notice tone="error">{state.model.error.message}</Notice>}
      {state.modelView && (
        <SearchModelResource
          title="语义模型"
          view={state.modelView}
          pending={state.command.pending}
          onPrepare={state.prepare}
          onCancel={state.cancel}
        />
      )}
      {state.reranker.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取相关性复核模型状态…
        </p>
      )}
      {state.reranker.isError && <Notice tone="error">{state.reranker.error.message}</Notice>}
      {state.rerankerView && (
        <SearchModelResource
          title="相关性复核模型"
          view={state.rerankerView}
          pending={state.command.pending}
          onPrepare={state.prepareReranker}
          onCancel={state.cancelReranker}
        />
      )}
      {state.index.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取索引状态…
        </p>
      )}
      {state.index.isError && <Notice tone="error">{state.index.error.message}</Notice>}
      {state.indexView && (
        <div className="space-y-2 rounded-xl bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">搜索索引</span>
              <Badge variant={state.indexView.tone}>{state.indexView.label}</Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs"
              onClick={state.rebuild}
              disabled={state.command.pending || state.indexView.rebuilding}
            >
              重建索引
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {state.indexView.lexicalLabel} · {state.indexView.coverageLabel}
          </p>
          {state.indexView.pendingLabel && (
            <p className="text-xs text-muted-foreground">{state.indexView.pendingLabel}</p>
          )}
          {state.index.data?.error && <Notice tone="error">{state.index.data.error}</Notice>}
        </div>
      )}
      {state.command.error && <Notice tone="error">{state.command.error}</Notice>}
    </section>
  );
};
