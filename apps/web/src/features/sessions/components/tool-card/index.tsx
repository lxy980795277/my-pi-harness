import type { ToolCallView, ToolDecisionInput } from '@my-pi-harness/protocol';
import { ShieldCheck, Wrench } from 'lucide-react';
import { memo, type FC } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useToolCard } from '@/features/sessions/hooks/use-tool-card';

interface ToolCardProps {
  tool: ToolCallView;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Tool arguments, recorded diffs and outcomes are plain text from committed activity, never HTML. */
export const ToolCard: FC<ToolCardProps> = memo(({ tool, onDecide }) => {
  const state = useToolCard(tool, onDecide);
  return (
    <div
      className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4"
      aria-label={`${tool.name} 工具调用`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <Wrench width={14} height={14} aria-hidden />
          <span className="truncate">{tool.name}</span>
        </span>
        <Badge>{state.statusLabel}</Badge>
      </div>
      <p className="text-xs leading-6 break-words whitespace-pre-wrap">{tool.summary}</p>
      {tool.diff !== null && (
        <details
          open={state.needsApproval}
          className="rounded-lg border border-border/60 bg-background p-3"
        >
          <summary className="cursor-pointer text-xs font-medium">文件差异</summary>
          <pre className="mt-3 max-h-72 overflow-auto font-mono text-[11px] leading-5 whitespace-pre-wrap">
            {tool.diff}
          </pre>
        </details>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">调用参数</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap">
          {state.argumentsText}
        </pre>
      </details>
      {tool.result !== null && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">执行结果</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap">
            {tool.result}
          </pre>
        </details>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.needsApproval && (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck width={14} height={14} aria-hidden />
            仅批准这一次操作，请先确认目标和调用参数。
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={state.allow} disabled={state.pending}>
              允许本次操作
            </Button>
            <Button type="button" variant="outline" onClick={state.deny} disabled={state.pending}>
              拒绝本次操作
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
