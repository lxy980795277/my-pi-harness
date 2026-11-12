import type { SearchSourceSelection, SessionSnapshot } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { ArrowLeft, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SourceExcerpt } from '@/features/search/components/source-excerpt';
import { SourceWorkspace } from '@/features/search/components/source-workspace';
import { useSourceReader } from '@/features/search/hooks/use-source-reader';
import { sourceSelectionKey } from '@/features/search/utils/search';
import type { Action } from '@/types/events';

interface SourceReaderProps {
  ownerId: string;
  selection: SearchSourceSelection;
  active: SessionSnapshot | undefined;
  onBack: Action;
  onClose: Action;
}

/** Historical branches and child-task windows remain readable while the active root Run continues. */
export const SourceReader: FC<SourceReaderProps> = ({
  ownerId,
  selection,
  active,
  onBack,
  onClose,
}) => {
  const state = useSourceReader(ownerId, selection, active, onClose);
  const window = state.query.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" className="gap-1.5 px-0" onClick={onBack}>
          <ArrowLeft width={14} height={14} aria-hidden />
          返回搜索结果
        </Button>
        {state.canLocate && (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={state.locate}
            disabled={state.action.pending}
          >
            <LocateFixed width={14} height={14} aria-hidden />
            定位到当前对话
          </Button>
        )}
      </div>
      {state.query.isFetching && <Notice>正在核对并读取原文…</Notice>}
      {state.query.isError && <Notice tone="error">{state.query.error.message}</Notice>}
      {state.action.error && <Notice tone="error">{state.action.error}</Notice>}
      {!state.query.isError && !state.query.isFetching && window && (
        <>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{window.title}</h3>
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <SourceWorkspace workspaceId={window.workspaceId} />
            </div>
            <p className="text-xs text-muted-foreground">
              只读来源{window.archived && ' · 已归档'}
              {window.historicalBranch && ' · 历史分支'}
              {selection.target.kind === 'message' &&
                selection.target.taskId !== undefined &&
                ' · 子任务'}
              ，阅读不会改变执行分支。
            </p>
          </div>
          {state.selectedText && (
            <section className="space-y-2 rounded-xl bg-muted/40 p-3" aria-label="搜索命中片段">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-medium">命中片段</h4>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={state.quoteSelected}
                  disabled={state.action.pending}
                >
                  引用命中片段
                </Button>
              </div>
              <p className="text-xs leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {state.selectedText}
              </p>
            </section>
          )}
          {window.items.map((excerpt) => {
            return (
              <SourceExcerpt
                key={sourceSelectionKey(excerpt)}
                excerpt={excerpt}
                onQuote={state.quote}
                disabled={state.action.pending || state.query.isFetching}
              />
            );
          })}
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                disabled={window.previous === null || state.query.isFetching}
                onClick={state.previous}
              >
                上一组消息
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={window.next === null || state.query.isFetching}
                onClick={state.next}
              >
                下一组消息
              </Button>
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                disabled={!state.canPreviousText || state.query.isFetching}
                onClick={state.previousText}
              >
                本条上段原文
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!state.canNextText || state.query.isFetching}
                onClick={state.nextText}
              >
                本条下段原文
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
