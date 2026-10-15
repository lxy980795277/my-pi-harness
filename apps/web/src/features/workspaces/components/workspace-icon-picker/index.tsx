import type { WorkspaceIcon as WorkspaceIconId } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover } from '@/components/ui/popover';
import { PopoverContent } from '@/components/ui/popover/popover-content';
import { PopoverTrigger } from '@/components/ui/popover/popover-trigger';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { WorkspaceIconOption } from '@/features/workspaces/components/workspace-icon-option';
import { useWorkspaceIconPicker } from '@/features/workspaces/hooks/use-workspace-icon-picker';

interface WorkspaceIconPickerProps {
  value: WorkspaceIconId;
  onChange: (icon: WorkspaceIconId) => void;
  disabled: boolean;
}

/** A compact catalog changes only the icon; color and emoji are intentionally absent. */
export const WorkspaceIconPicker: FC<WorkspaceIconPickerProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const state = useWorkspaceIconPicker(onChange);
  return (
    <Popover open={state.open} onOpenChange={state.changeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-10 rounded-none border-r border-border text-foreground focus-visible:-outline-offset-4"
          aria-label="选择工作区图标"
          disabled={disabled}
        >
          <WorkspaceIcon icon={value} width={18} height={18} />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="工作区图标" className="w-64 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">图标</span>
          <Button type="button" variant="ghost" onClick={state.reset} className="h-8 px-2">
            重置
          </Button>
        </div>
        <Input
          aria-label="搜索工作区图标"
          placeholder="搜索图标"
          value={state.query}
          onChange={state.changeQuery}
          className="mb-2 h-8 rounded-lg text-xs"
        />
        <div className="grid grid-cols-6 justify-items-center gap-1.5">
          {state.options.map((option) => {
            return (
              <WorkspaceIconOption
                key={option.id}
                option={option}
                selected={value}
                onSelect={state.select}
              />
            );
          })}
        </div>
        {state.options.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">没有匹配的图标</div>
        )}
      </PopoverContent>
    </Popover>
  );
};
