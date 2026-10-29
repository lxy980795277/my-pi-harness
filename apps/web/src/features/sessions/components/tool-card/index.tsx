import type { ToolCallView, ToolDecisionInput } from '@my-pi-harness/protocol';
import { ChevronRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { memo, type FC } from 'react';
import { ActivityRow } from '@/components/activity-row';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { ApprovalAudit } from '@/features/sessions/components/approval-audit';
import { OfficeArtifact } from '@/features/office/components/office-artifact';
import { useToolCard } from '@/features/sessions/hooks/use-tool-card';
import { cn } from '@/utils/cn';

interface ToolCardProps {
  tool: ToolCallView;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Quiet disclosure rows retain exact recorded parameters and visible approval controls. */
export const ToolCard: FC<ToolCardProps> = memo(({ tool, onDecide }) => {
  const state = useToolCard(tool, onDecide);
  return (
    <div className="min-w-0 space-y-1" aria-label={`${tool.name} 工具调用`} aria-busy={state.busy}>
      <ActivityRow
        type="button"
        className="group/tool-row"
        onClick={state.toggleDetails}
        aria-expanded={state.detailsOpen}
        aria-controls={`tool-details-${tool.id}`}
        aria-label={state.detailsLabel}
        disabled={state.needsApproval}
      >
        <span className="relative h-3.5 w-3.5 shrink-0" aria-hidden>
          {!state.busy && (
            <state.Icon
              width={14}
              height={14}
              data-slot="tool-icon"
              className="absolute inset-0 group-hover/tool-row:hidden group-focus-visible/tool-row:hidden"
            />
          )}
          {state.busy && (
            <LoaderCircle
              width={14}
              height={14}
              data-slot="tool-loading"
              className="absolute inset-0 animate-spin group-hover/tool-row:hidden group-focus-visible/tool-row:hidden motion-reduce:animate-none"
            />
          )}
          <ChevronRight
            width={14}
            height={14}
            data-slot="tool-chevron"
            className={cn(
              'absolute inset-0 hidden group-hover/tool-row:block group-focus-visible/tool-row:block',
              state.detailsOpen && 'rotate-90',
            )}
          />
        </span>
        <span className="shrink-0">{state.name}</span>
        {state.summary.length > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate text-left" title={state.summary}>
              {state.summary}
            </span>
          </>
        )}
        {state.busy && (
          <span className="sr-only" role="status">
            {state.statusLabel}
          </span>
        )}
        {state.showStatus && (
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-xs',
              state.statusClassName,
            )}
            role="status"
          >
            {state.statusLabel}
          </span>
        )}
      </ActivityRow>
      {state.detailsOpen && (
        <div
          id={`tool-details-${tool.id}`}
          className="ml-6 min-w-0 space-y-3 rounded-xl bg-muted/50 px-3 py-3"
        >
          <section aria-label="工具来源" className="space-y-1 text-xs text-muted-foreground">
            <p>{state.sourceLabel}</p>
            <p>{state.dispatchLabel}</p>
            {state.fingerprint && (
              <p className="font-mono [overflow-wrap:anywhere]">定义指纹 · {state.fingerprint}</p>
            )}
          </section>
          {state.unknown && (
            <Notice tone="error">结果未知，操作可能已生效，需要核验。不会自动重试此操作。</Notice>
          )}
          {tool.diff !== null && (
            <section aria-label="文件差异" className="min-w-0 space-y-2">
              <p className="text-xs text-muted-foreground">文件差异</p>
              <pre className="max-h-72 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap">
                {tool.diff}
              </pre>
            </section>
          )}
          <section aria-label="调用参数" className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">调用参数</p>
            <pre className="max-h-64 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap">
              {state.argumentsText}
            </pre>
          </section>
          {tool.result !== null && (
            <section aria-label="执行结果" className="min-w-0 space-y-2">
              <p className="text-xs text-muted-foreground">执行结果</p>
              <pre className="max-h-80 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap">
                {tool.result}
              </pre>
            </section>
          )}
          <OfficeArtifact tool={tool} />
          <ApprovalAudit approval={tool.approval} />
          {state.needsApproval && (
            <div className="space-y-3 border-t border-border/60 pt-3">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck width={14} height={14} aria-hidden />
                仅批准这一次操作，请先确认目标和调用参数。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={state.allow} disabled={state.pending}>
                  允许本次操作
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={state.deny}
                  disabled={state.pending}
                >
                  拒绝本次操作
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
});
