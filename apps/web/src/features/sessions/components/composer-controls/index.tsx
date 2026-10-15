import { Hand, Plus, Sparkles, Settings2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { WorkspaceIcon } from '@/components/workspace-icon';
import type { ComposerChoices } from '@/features/sessions/types/composer-view';
import { APPROVAL_OPTIONS } from '@/features/sessions/utils/composer-options';

interface ComposerControlsProps {
  id: string;
  choices: ComposerChoices;
}

/** Controls follow the same context, directory, approval and model order in every composer. */
export const ComposerControls: FC<ComposerControlsProps> = ({ id, choices }) => {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-2">
      <span title="添加上下文将在后续上下文迭代开放">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          disabled
          aria-label="添加上下文（即将支持）"
        >
          <Plus width={18} height={18} aria-hidden />
        </Button>
      </span>
      <div
        className="flex min-w-0 items-center gap-1 text-muted-foreground"
        title={choices.workspacePath}
      >
        <WorkspaceIcon icon={choices.workspaceIcon} expanded className="shrink-0" />
        {choices.workspaceLocked && (
          <span className="max-w-32 truncate px-1 text-xs">{choices.workspaceLabel}</span>
        )}
        {!choices.workspaceLocked && (
          <SelectField
            id={`${id}-workspace`}
            ariaLabel="选择工作区"
            value={choices.workspaceValue}
            options={choices.workspaceOptions}
            onValueChange={choices.changeWorkspace}
            disabled={choices.disabled}
            className="h-8 w-auto max-w-40 gap-1 rounded-lg border-transparent bg-transparent px-1 text-xs shadow-none"
            placeholder="选择工作区"
          />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <Hand width={16} height={16} className="shrink-0" aria-hidden />
        <SelectField
          id={`${id}-approval`}
          ariaLabel="执行批准方式"
          value={choices.approvalMode}
          options={APPROVAL_OPTIONS}
          onValueChange={choices.changeApprovalMode}
          disabled={choices.disabled}
          className="h-8 w-auto max-w-32 gap-1 rounded-lg border-transparent bg-transparent px-1 text-xs shadow-none"
        />
      </div>
      <div className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <Sparkles width={16} height={16} className="shrink-0" aria-hidden />
        <SelectField
          id={`${id}-model`}
          ariaLabel="对话模型"
          value={choices.modelKey}
          options={choices.modelOptions}
          onValueChange={choices.changeModel}
          disabled={choices.disabled || choices.modelOptions.length === 0}
          className="h-8 w-auto max-w-64 gap-1 rounded-lg border-transparent bg-transparent px-1 text-xs shadow-none"
          placeholder="选择模型"
        />
      </div>
      {choices.thinkingOptions.length > 1 && (
        <SelectField
          id={`${id}-thinking`}
          ariaLabel="思考等级"
          value={choices.thinking}
          options={choices.thinkingOptions}
          onValueChange={choices.changeThinking}
          disabled={choices.disabled}
          className="h-8 w-auto max-w-20 gap-1 rounded-lg border-transparent bg-transparent px-1 text-xs shadow-none"
        />
      )}
      {choices.modelOptions.length === 0 && (
        <Button
          type="button"
          variant="ghost"
          onClick={choices.settings}
          className="h-8 rounded-lg px-2"
          aria-label="配置对话模型"
        >
          <Settings2 width={14} height={14} aria-hidden />
          配置模型
        </Button>
      )}
    </div>
  );
};
