import type { SessionSnapshot, WorkSnapshot } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { useCheckpoints } from '@/features/work/hooks/use-checkpoints';

interface CheckpointPanelProps {
  work: WorkSnapshot;
  session: SessionSnapshot;
  running: boolean;
  onCommand: (command: string, input: unknown) => Promise<void>;
}
/** Users compare current/checkpoint states before confirming a branch restore or state reset. */
export const CheckpointPanel: FC<CheckpointPanelProps> = ({
  work,
  session,
  running,
  onCommand,
}) => {
  const state = useCheckpoints(work, session, onCommand);
  const disabled = running || state.action.pending;
  return (
    <div className="space-y-5">
      <form className="flex gap-2" onSubmit={state.create}>
        <Input
          aria-label="检查点名称"
          value={state.label}
          onChange={state.changeLabel}
          placeholder="检查点名称"
          maxLength={200}
          disabled={disabled || work.checkpoints.length >= 100}
        />
        <Button
          type="submit"
          disabled={disabled || !state.label.trim() || work.checkpoints.length >= 100}
        >
          创建检查点
        </Button>
      </form>
      {state.action.error && <Notice tone="error">{state.action.error}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="checkpoint-left">比较基准</Label>
          <SelectField
            id="checkpoint-left"
            ariaLabel="比较基准"
            value={state.leftId}
            options={state.options}
            onValueChange={state.setLeftId}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="checkpoint-right">比较目标</Label>
          <SelectField
            id="checkpoint-right"
            ariaLabel="比较目标"
            value={state.rightId}
            options={state.options}
            onValueChange={state.setRightId}
          />
        </div>
      </div>
      <div className="space-y-3">
        {state.differences.map((row) => {
          return (
            <div key={row.label} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{row.label}</span>
                {row.changed && <Badge>有变化</Badge>}
                {!row.changed && <span className="text-[11px] text-muted-foreground">相同</span>}
              </div>
              {row.changed && (
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <div className="max-h-40 overflow-y-auto rounded-lg bg-muted p-2 text-xs break-words whitespace-pre-wrap">
                    {row.left}
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg bg-muted p-2 text-xs break-words whitespace-pre-wrap">
                    {row.right}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" disabled={disabled} onClick={state.openReset}>
          重置工作状态
        </Button>
        <Button
          type="button"
          disabled={disabled || state.rightId === 'current'}
          onClick={state.openRestore}
        >
          恢复目标检查点
        </Button>
      </div>
      <ConfirmDialog
        open={state.confirmation !== null}
        onOpenChange={state.changeConfirmation}
        title={state.confirmTitle}
        description={state.confirmDescription}
        confirmLabel={state.confirmLabel}
        pending={state.action.pending}
        onConfirm={state.confirm}
        error={state.action.error}
      />
    </div>
  );
};
