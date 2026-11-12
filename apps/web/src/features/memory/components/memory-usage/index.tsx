import type { FC } from 'react';
import { Notice } from '@/components/ui/notice';
import { useMemoryUsagePanel } from '@/features/memory/hooks/use-memory-usage-panel';
import { memoryCategoryLabel } from '@/features/memory/utils/memory-view';

interface MemoryUsagePanelProps {
  sessionId: string;
  runId: string | null;
  running: boolean;
}

/** Displays the latest dispatched request's frozen memory block, including forgotten historical text. */
export const MemoryUsagePanel: FC<MemoryUsagePanelProps> = ({ sessionId, runId, running }) => {
  const state = useMemoryUsagePanel(sessionId, runId, running);
  const query = state.query;
  const usage = query.data;
  return (
    <section className="space-y-3" aria-label="本次采用的记忆">
      <h3 className="text-sm font-medium">本次采用的记忆</h3>
      {runId === null && <p className="text-xs text-muted-foreground">尚无运行记录。</p>}
      {runId !== null && query.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取采用记录…
        </p>
      )}
      {state.incomplete && <Notice>本次检索未覆盖全部记忆，未检索到的条目未被采用。</Notice>}
      {query.isError && <Notice tone="error">{query.error.message}</Notice>}
      {usage === null && <p className="text-xs text-muted-foreground">尚无已派发的模型请求。</p>}
      {usage && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{state.selectionLabel}</p>
          {state.verificationLabel && <p>{state.verificationLabel}</p>}
          {state.selectionSummary && <p>{state.selectionSummary}</p>}
        </div>
      )}
      {usage && usage.entries.length === 0 && (
        <p className="text-xs text-muted-foreground">本次请求未采用长期记忆。</p>
      )}
      {usage && usage.entries.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs leading-5 text-muted-foreground">
            以下为最近一次已派发请求使用的内容，之后的编辑或遗忘不会改写此记录。
          </p>
          {state.entries.map(({ entry, sourceLabel, modeLabel, changeLabel }) => {
            return (
              <details key={entry.id} className="rounded-xl border border-border p-3">
                <summary className="cursor-pointer text-xs">
                  {modeLabel} · {memoryCategoryLabel(entry.category)} · 修订 {entry.revision}
                  {entry.scope.kind === 'user' && ' · 当前用户'}
                  {entry.scope.kind === 'workspace' && ' · 工作区'}
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">{sourceLabel}</p>
                <p className="mt-1 text-xs text-muted-foreground">{changeLabel}</p>
                <p className="mt-2 text-xs leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {entry.body}
                </p>
              </details>
            );
          })}
        </div>
      )}
      {(state.omissions.length > 0 || state.moreOmissions > 0) && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-xs">未采用的记忆</summary>
          <div className="mt-3 space-y-3">
            {state.omissions.map(({ omission, modeLabel, reasonLabel }) => {
              return (
                <div key={omission.id} className="space-y-1 text-xs">
                  <p>
                    {modeLabel} · {reasonLabel}
                  </p>
                  <p className="[overflow-wrap:anywhere] text-muted-foreground">
                    记忆 {omission.id} · 修订 {omission.revision}
                  </p>
                </div>
              );
            })}
            {state.moreOmissions > 0 && (
              <p className="text-xs text-muted-foreground">
                另有 {state.moreOmissions} 项未采用，详细原因未记录。
              </p>
            )}
          </div>
        </details>
      )}
    </section>
  );
};
