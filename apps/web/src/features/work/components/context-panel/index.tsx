import type { WorkState } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useContextPanel } from '@/features/work/hooks/use-context-panel';
import { formatCount } from '@/features/work/utils/work-view';

interface ContextPanelProps {
  state: WorkState;
  running: boolean;
  workspaceId: string | null;
  onCommand: (command: string, input: unknown) => Promise<void>;
}
/** Shows the frozen rule bodies and context projection used by the latest run. */
export const ContextPanel: FC<ContextPanelProps> = ({ state, running, workspaceId, onCommand }) => {
  const view = useContextPanel(state, workspaceId, onCommand);
  const { compact } = view;
  return (
    <div className="space-y-5">
      {state.usage && (
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-xs">
          <div>
            估算输入 <span className="font-medium">{formatCount(state.usage.estimatedTokens)}</span>{' '}
            tokens
          </div>
          <div>模型窗口 {formatCount(state.usage.windowTokens)} tokens</div>
          <div>输出预留 {formatCount(state.usage.reservedOutput)} tokens</div>
          <div>输入预算 {formatCount(state.usage.inputBudget)} tokens</div>
          <div className="col-span-2 text-muted-foreground">
            本次裁剪 {state.usage.trimmedMessages} 条历史消息；估算值不代表供应商计费。
          </div>
        </div>
      )}
      {!state.usage && <Notice>首次运行后显示上下文估算。</Notice>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">上下文摘要</span>
        <Button
          type="button"
          variant="outline"
          disabled={running || compact.pending}
          onClick={compact.run}
        >
          压缩上下文
        </Button>
      </div>
      {compact.pending && <Notice>正在生成摘要，完成前保留原上下文…</Notice>}
      {compact.error && <Notice tone="error">{compact.error}</Notice>}
      {state.compaction && (
        <div className="rounded-xl border border-border p-3 text-xs leading-6 whitespace-pre-wrap">
          {state.compaction.summary}
        </div>
      )}
      {!state.compaction && <div className="text-xs text-muted-foreground">暂无压缩摘要</div>}
      <div className="space-y-3">
        <span className="text-sm font-medium">生效规则</span>
        {state.rules.length === 0 && (
          <div className="text-xs text-muted-foreground">最近一次运行没有加载 AGENTS.md。</div>
        )}
        {state.rules.map((rule) => {
          return (
            <details key={rule.path} className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-xs font-medium">{rule.path}</summary>
              <div className="mt-2 text-[10px] text-muted-foreground">
                {rule.byteLength} bytes · SHA-256 {rule.hash}
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto text-xs leading-6 break-words whitespace-pre-wrap">
                {rule.content}
              </div>
            </details>
          );
        })}
      </div>
      {workspaceId && (
        <div className="space-y-3 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={view.togglePreview}>
            查看工作区当前规则
          </Button>
          {view.preview && view.rules.isPending && <Notice>正在读取工作区规则…</Notice>}
          {view.preview && view.rules.isError && (
            <Notice tone="error">{view.rules.error.message}</Notice>
          )}
          {view.preview && view.rules.data && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                根规则预览；引用文件的下级规则将在下一次运行按实际引用加载。
              </div>
              {view.rules.data.map((rule) => {
                return (
                  <details key={rule.path} className="rounded-xl border border-border p-3">
                    <summary className="cursor-pointer text-xs font-medium">{rule.path}</summary>
                    <div className="mt-2 max-h-64 overflow-y-auto text-xs leading-6 whitespace-pre-wrap">
                      {rule.content}
                    </div>
                  </details>
                );
              })}
              {view.rules.data.length === 0 && (
                <div className="text-xs text-muted-foreground">工作区根目录没有 AGENTS.md。</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
