import type { TraceEntry } from '@my-pi-harness/protocol';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Tabs } from '@/components/ui/tabs';
import { TabsList } from '@/components/ui/tabs/tabs-list';
import { TabsTrigger } from '@/components/ui/tabs/tabs-trigger';
import { TabsContent } from '@/components/ui/tabs/tabs-content';
import { TraceContentItem } from '@/features/trace/components/trace-content-item';
import { useTraceContent } from '@/features/trace/hooks/use-trace-content';
import { TRACE_SECTION_OPTIONS } from '@/features/trace/utils/trace-view';
import { describeError } from '@/utils/describe-error';

interface TraceContentProps {
  sessionId: string;
  entry: TraceEntry;
  onBack: () => void;
}

/** Plain text preserves audited content without executing Markdown, HTML or embedded assets. */
export const TraceContent: FC<TraceContentProps> = ({ sessionId, entry, onBack }) => {
  const state = useTraceContent(sessionId, entry);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="事件详情">
      <Tabs
        value={state.section}
        onValueChange={state.changeSection}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 space-y-4 border-b border-border px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            className="-ml-2 h-7 gap-1 text-xs lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft width={14} height={14} aria-hidden /> 返回事件
          </Button>
          <h3 className="text-sm font-semibold break-words">{entry.title}</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            {state.facts.map((fact) => {
              return (
                <div key={fact.label} className="contents">
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="min-w-0 break-all">{fact.value}</dd>
                </div>
              );
            })}
          </dl>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          {entry.modelRequestId !== null && (
            <TabsList aria-label="最终请求内容">
              {TRACE_SECTION_OPTIONS.map((section) => {
                return (
                  <TabsTrigger key={section.value} value={section.value}>
                    {section.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          )}
        </div>
        <TabsContent value={state.section} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {state.query.isPending && (
            <p className="text-xs text-muted-foreground" role="status">
              正在读取已提交内容…
            </p>
          )}
          {state.query.isError && (
            <div className="space-y-3">
              <Notice tone="error">{describeError(state.query.error)}</Notice>
              <Button type="button" variant="outline" className="h-8 text-xs" onClick={state.retry}>
                重新读取
              </Button>
            </div>
          )}
          {state.query.data && state.query.data.items.length === 0 && (
            <p className="text-xs text-muted-foreground">当前部分没有已记录内容。</p>
          )}
          {state.query.data?.items.map((item) => {
            return (
              <TraceContentItem
                key={state.section + ':' + String(item.index) + ':' + String(item.offset)}
                sessionId={sessionId}
                requestId={entry.modelRequestId}
                item={item}
              />
            );
          })}
        </TabsContent>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>第 {state.page} 段</span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={state.previous}
              disabled={state.page === 1 || state.query.isFetching}
            >
              <ChevronLeft width={14} height={14} aria-hidden /> 上一段
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={state.next}
              disabled={state.query.data?.nextCursor == null || state.query.isFetching}
            >
              下一段 <ChevronRight width={14} height={14} aria-hidden />
            </Button>
          </div>
        </footer>
      </Tabs>
    </section>
  );
};
