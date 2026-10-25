import type { ApprovalMode, QueueInput, QueuePatchInput } from '@my-pi-harness/protocol';
import type { FC } from 'react';

import { AttachmentList } from '@/features/attachments/components/attachment-list';
import { SkillPicker } from '@/features/skills/components/skill-picker';
import { McpToolPicker } from '@/features/mcp/components/mcp-tool-picker';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { useQueueItem } from '@/features/sessions/hooks/use-queue-item';
import { Label } from '@/components/ui/label';

interface QueueItemProps {
  workspaceId: string | null;
  approvalMode: ApprovalMode;
  running: boolean;
  input: QueueInput;
  onUpdate: (id: string, patch: QueuePatchInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Queue edits carry the observed revision; accepted input is never a local-only row. */
export const QueueItem: FC<QueueItemProps> = ({
  input,
  workspaceId,
  approvalMode,
  running,
  onUpdate,
  onDelete,
}) => {
  const { editing, text, changeText, start, cancel, update, remove, pending, error, mcp, skills } =
    useQueueItem(input, workspaceId, approvalMode, running, onUpdate, onDelete);

  return (
    <li className="space-y-2 rounded border border-border bg-background p-3">
      <p className="text-[11px] text-muted-foreground">
        {input.mode === 'steer' && '引导输入'}
        {input.mode === 'follow-up' && '后续输入'} · {input.modelId}
      </p>
      {input.attachmentIds && input.attachmentIds.length > 0 && (
        <AttachmentList ids={input.attachmentIds} />
      )}
      {!editing && (
        <p className="max-h-24 overflow-y-auto text-xs leading-6 break-words whitespace-pre-wrap">
          {input.text}
        </p>
      )}
      {editing && (
        <>
          <Label htmlFor={`queue-text-${input.id}`} className="sr-only">
            排队消息内容
          </Label>
          <Textarea
            id={`queue-text-${input.id}`}
            value={text}
            disabled={pending}
            maxLength={64_000}
            onChange={changeText}
          />
        </>
      )}
      <McpToolPicker state={mcp} />
      <SkillPicker state={skills} />
      {editing && (
        <Button type="button" variant="ghost" onClick={mcp.openPicker} disabled={pending}>
          MCP 工具 · {mcp.selected.length}
        </Button>
      )}
      {editing && (
        <Button type="button" variant="ghost" onClick={skills.openPicker} disabled={pending}>
          Skills · {skills.selected.length}
        </Button>
      )}
      {skills.blocked && <Notice tone="error">Skill 选择已失效，请编辑并重新选择。</Notice>}
      {mcp.blocked && <Notice tone="error">MCP 选择已失效，请编辑并重新选择。</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        {!editing && (
          <Button type="button" variant="ghost" disabled={pending} onClick={start}>
            编辑
          </Button>
        )}
        {editing && (
          <Button
            type="button"
            variant="outline"
            disabled={pending || mcp.blocked || skills.blocked || text.trim().length === 0}
            onClick={update}
          >
            保存修改
          </Button>
        )}
        {editing && (
          <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
            取消编辑
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
          删除排队输入
        </Button>
      </div>
    </li>
  );
};
