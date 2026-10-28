import { Settings2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { WorkspaceIcon } from '@/components/workspace-icon';
import {
  AttachmentComposer,
  type AttachmentComposerProps,
} from '@/features/attachments/components/attachment-composer';
import type { SkillSelectionState } from '@/features/skills/types/skill';
import type { McpSelectionState } from '@/features/mcp/types/mcp';
import type { ComposerChoices } from '@/features/sessions/types/composer';
import { ModelSelect } from '@/features/models/components/model-select';
import { ApprovalSelect } from '@/features/sessions/components/approval-select';

interface ComposerControlsProps {
  id: string;
  choices: ComposerChoices;
  attachment: AttachmentComposerProps;
  mcp: McpSelectionState;
  skills: SkillSelectionState;
}

/** Controls follow the same context, directory, approval and model order in every composer. */
export const ComposerControls: FC<ComposerControlsProps> = ({
  id,
  choices,
  attachment,
  mcp,
  skills,
}) => {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-2">
      <AttachmentComposer {...attachment} />
      {mcp.selected.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-lg px-1 text-xs"
          onClick={mcp.openPicker}
        >
          MCP · {mcp.selected.length}
        </Button>
      )}
      {skills.selected.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-lg px-1 text-xs"
          onClick={skills.openPicker}
        >
          Skills · {skills.selected.length}
        </Button>
      )}
      <div className="flex min-w-0 items-center gap-1 text-muted-foreground">
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
      <ApprovalSelect
        id={`${id}-approval`}
        value={choices.approvalMode}
        onValueChange={choices.changeApprovalMode}
        disabled={choices.disabled}
      />
      <ModelSelect
        id={`${id}-model`}
        groups={choices.modelGroups}
        value={choices.modelKey}
        thinking={choices.thinking}
        thinkingOptions={choices.thinkingOptions}
        onModelChange={choices.changeModel}
        onThinkingChange={choices.changeThinking}
        disabled={choices.disabled}
      />
      {choices.modelGroups.length === 0 && (
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
