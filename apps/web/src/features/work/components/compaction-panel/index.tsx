import type { WorkSnapshot } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { WorkDifferences } from '@/features/work/components/work-differences';
import { useCompactions } from '@/features/work/hooks/use-compactions';
import { formatCount } from '@/features/work/utils/work-view';
interface CompactionPanelProps {
  work: WorkSnapshot;
  running: boolean;
  onCommand: (name: string, input: unknown) => Promise<void>;
}
/** Automatic context checkpoints are distinct from user-created session snapshots. */
export const CompactionPanel: FC<CompactionPanelProps> = ({ work, running, onCommand }) => {
  const view = useCompactions(work, onCommand);
  if (!view.right) {
    return <div className="text-xs text-muted-foreground">暂无上下文检查点</div>;
  }
  return (
    <div className="space-y-3" aria-label="上下文检查点">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">上下文检查点</span>
        <Button
          type="button"
          variant="outline"
          disabled={running || view.action.pending || view.selected}
          onClick={view.openConfirmation}
        >
          使用所选版本
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="compaction-left">比较基准</Label>
          <SelectField
            id="compaction-left"
            ariaLabel="上下文比较基准"
            value={view.leftId}
            options={view.options}
            onValueChange={view.setLeftId}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="compaction-right">查看版本</Label>
          <SelectField
            id="compaction-right"
            ariaLabel="上下文查看版本"
            value={view.rightId}
            options={view.options}
            onValueChange={view.setRightId}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {view.selected && <Badge>当前生效</Badge>}
        {view.right.strategy === 'fallback' && <Badge>本地降级摘要</Badge>}
        <span>
          {formatCount(view.right.beforeTokens)} → {formatCount(view.right.afterTokens)} tokens
        </span>
        <span>覆盖 {view.right.sourceMessages} 条消息</span>
      </div>
      {view.summary && view.leftId === view.rightId && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          {view.summary.map((row) => {
            return (
              <div key={row.label} className="space-y-0.5 text-xs leading-6">
                <span className="font-medium">{row.label}</span>
                <div className="whitespace-pre-wrap text-muted-foreground">{row.content}</div>
              </div>
            );
          })}
        </div>
      )}
      {view.leftId !== view.rightId && view.rows && <WorkDifferences rows={view.rows} />}
      {view.action.error && <Notice tone="error">{view.action.error}</Notice>}
      <ConfirmDialog
        open={view.confirming}
        onOpenChange={view.setConfirming}
        title="使用上下文检查点"
        description="将以所选摘要继续，排除切换前的历史尾部；完整会话记录仍保留。此操作不回滚文件或命令。"
        confirmLabel="使用此版本"
        pending={view.action.pending}
        onConfirm={view.action.run}
        error={view.action.error}
      />
    </div>
  );
};
