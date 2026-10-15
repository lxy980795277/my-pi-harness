import type { WorkspaceIcon } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import type { WorkspaceIconOption as IconOption } from '@/components/workspace-icon/workspace-icons';
import { cn } from '@/utils/cn';

interface WorkspaceIconOptionProps {
  option: IconOption;
  selected: WorkspaceIcon;
  onSelect: (icon: WorkspaceIcon) => void;
}

/** Each icon remains a named button with the current selection announced. */
export const WorkspaceIconOption: FC<WorkspaceIconOptionProps> = ({
  option,
  selected,
  onSelect,
}) => {
  const select = (): void => {
    onSelect(option.id);
  };
  const Icon = option.Icon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8 rounded-lg text-foreground', {
        'bg-accent text-accent-foreground': selected === option.id,
      })}
      aria-label={`使用${option.label}图标`}
      aria-pressed={selected === option.id}
      title={option.label}
      onClick={select}
    >
      <Icon width={18} height={18} aria-hidden />
    </Button>
  );
};
