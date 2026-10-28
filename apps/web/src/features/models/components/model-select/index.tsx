import { ChevronDown } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu/dropdown-menu-trigger';
import { DropdownMenuContent } from '@/components/ui/dropdown-menu/dropdown-menu-content';
import { DropdownMenuSub } from '@/components/ui/dropdown-menu/dropdown-menu-sub';
import { DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu/dropdown-menu-sub-trigger';
import { DropdownMenuSubContent } from '@/components/ui/dropdown-menu/dropdown-menu-sub-content';
import { DropdownMenuRadioGroup } from '@/components/ui/dropdown-menu/dropdown-menu-radio-group';
import { DropdownMenuRadioItem } from '@/components/ui/dropdown-menu/dropdown-menu-radio-item';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu/dropdown-menu-separator';
import type { SelectOption } from '@/components/ui/select-field';
import { ModelMenuIcon } from '@/features/models/components/model-menu-icon';
import type { ModelMenuGroup } from '@/features/models/types/model-menu';
import { modelMenuPresentation } from '@/features/models/utils/model-menu';

interface ModelSelectProps {
  id: string;
  groups: readonly ModelMenuGroup[];
  value: string;
  thinking: string;
  thinkingOptions: readonly SelectOption[];
  disabled: boolean;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
}

/** One model menu places reasoning above provider submenus for every conversation. */
export const ModelSelect: FC<ModelSelectProps> = ({
  id,
  groups,
  value,
  thinking,
  thinkingOptions,
  disabled,
  onModelChange,
  onThinkingChange,
}) => {
  const current = modelMenuPresentation(groups, value, thinking, thinkingOptions);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="ghost"
          disabled={disabled || groups.length === 0}
          aria-label="对话模型"
          className="h-8 max-w-80 min-w-0 justify-start gap-1.5 rounded-lg px-1 text-xs font-normal text-muted-foreground"
        >
          <ModelMenuIcon builtinId={current.builtinId} />
          <span className="truncate">{current.label}</span>
          <span className="shrink-0 text-muted-foreground/70">{current.thinkingLabel}</span>
          <ChevronDown width={14} height={14} className="shrink-0" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label="模型与推理设置">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label="推理强度">
            <span className="flex-1">推理强度</span>
            <span className="text-xs text-muted-foreground">{current.thinkingLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="推理强度选项">
            <DropdownMenuRadioGroup value={thinking} onValueChange={onThinkingChange}>
              {current.thinkingOptions.map((option) => {
                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                    description={option.description}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {groups.map((group) => {
          return (
            <DropdownMenuSub key={group.id}>
              <DropdownMenuSubTrigger aria-label={group.name}>
                <ModelMenuIcon builtinId={group.builtinId} />
                <span className="truncate">{group.name}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent aria-label={`${group.name}模型`}>
                <DropdownMenuRadioGroup value={value} onValueChange={onModelChange}>
                  {group.options.map((option) => {
                    return (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        aria-label={option.label}
                        disabled={option.disabled ?? false}
                      >
                        {option.name}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
