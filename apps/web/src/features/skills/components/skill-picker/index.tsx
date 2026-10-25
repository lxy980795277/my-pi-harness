import type { FC } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Notice } from '@/components/ui/notice';
import type { SkillPickerProps } from '@/features/skills/types/skill';

/** Explicit Skill choices do not approve the tools declared by their instructions. */
export const SkillPicker: FC<SkillPickerProps> = ({ state }) => {
  return (
    <Dialog open={state.open} onOpenChange={state.changeOpen}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-auto" closeLabel="关闭 Skill 选择">
        <DialogTitle>Skills · 已选 {state.selected.length}/16</DialogTitle>
        <DialogDescription>
          选中的指令和资源版本会随本次输入冻结；工具仍使用当前审批规则。
        </DialogDescription>
        {state.loading && (
          <p role="status" className="text-xs text-muted-foreground">
            正在读取…
          </p>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {state.rows.map((row) => {
          return (
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-3 py-3 text-left whitespace-normal"
              disabled={row.disabled}
              onClick={row.change}
              key={row.skill.id}
            >
              <span className="w-4 shrink-0">
                {row.selected && <Check width={16} height={16} aria-hidden />}
              </span>
              <span>
                <span className="block">{row.skill.name}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {row.skill.description}
                </span>
              </span>
            </Button>
          );
        })}
        {state.invalid.length > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={state.removeInvalid}
            disabled={state.locked}
          >
            移除失效选择
          </Button>
        )}
        {state.rows.length === 0 && !state.loading && (
          <p className="text-xs text-muted-foreground">尚无可用 Skill，可在设置中创建或安装。</p>
        )}
      </DialogContent>
    </Dialog>
  );
};
