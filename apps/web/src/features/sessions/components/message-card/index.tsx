import type { ApprovalMode, EditInput, MessageView } from '@my-pi-harness/protocol';
import { Check, Copy, Pencil } from 'lucide-react';
import { memo, type FC } from 'react';

import { Markdown } from '@/components/markdown';
import { LoadingDots } from '@/components/loading-dots';
import { RequestFailure } from '@/components/request-failure';
import { AttachmentList } from '@/features/attachments/components/attachment-list';
import { SkillPicker } from '@/features/skills/components/skill-picker';
import { McpToolPicker } from '@/features/mcp/components/mcp-tool-picker';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { useMessageEditor } from '@/features/sessions/hooks/use-message-editor';
import { useCopyText } from '@/hooks/use-copy-text';
import { Label } from '@/components/ui/label';
import { cn } from '@/utils/cn';

interface MessageCardProps {
  workspaceId: string | null;
  approvalMode: ApprovalMode;
  message: MessageView;
  failure: string | null;
  canEdit: boolean;
  onEdit: (input: EditInput) => Promise<void>;
}

const ROLE_LABELS: Record<MessageView['role'], string> = { user: '你', assistant: 'Agent' };
const STATUS_LABELS: Record<MessageView['status'], string> = {
  streaming: '生成中',
  complete: '完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '服务中断',
};

/** Displays message text and attachments; editing creates a new branch rather than replacing this fact. */
export const MessageCard: FC<MessageCardProps> = memo(
  ({ message, failure, workspaceId, approvalMode, canEdit, onEdit }) => {
    const { editing, text, changeText, submit, start, cancel, pending, error, mcp, skills } =
      useMessageEditor(message, workspaceId, approvalMode, onEdit);
    const copy = useCopyText(message.text);
    const streaming = message.status === 'streaming';
    const user = message.role === 'user';

    return (
      <article
        className={cn('group group/message min-w-0 space-y-1', user && 'flex flex-col items-end')}
        aria-label={`${ROLE_LABELS[message.role]}的消息`}
      >
        {!editing && (
          <div
            className={cn(
              'max-w-full min-w-0 space-y-3',
              user && 'rounded-2xl bg-muted px-3 py-1 text-foreground sm:max-w-[85%]',
            )}
          >
            {message.attachmentIds && message.attachmentIds.length > 0 && (
              <AttachmentList ids={message.attachmentIds} />
            )}
            {user && message.text.length > 0 && (
              <p className="text-sm leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {message.text}
              </p>
            )}
            {!user && message.text.length > 0 && (
              <Markdown text={message.text} streaming={streaming} />
            )}
          </div>
        )}
        {!editing && (user || message.status !== 'complete') && (
          <div
            className={cn(
              'flex min-h-7 flex-wrap items-center gap-x-0 gap-y-1 text-xs text-muted-foreground',
              user &&
                'pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100',
            )}
          >
            {streaming && (
              <span className="mr-2 inline-flex items-center" role="status">
                <LoadingDots />
                <span className="sr-only">{STATUS_LABELS.streaming}</span>
              </span>
            )}
            {failure !== null && <RequestFailure text={failure} />}
            {failure === null && !streaming && message.status !== 'complete' && (
              <span className="mr-2" role="status">
                {STATUS_LABELS[message.status]}
              </span>
            )}
            {user && message.text.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={copy.copy}
                disabled={copy.pending}
                aria-label="复制消息"
                title="复制消息"
              >
                {copy.copied && <Check width={14} height={14} aria-hidden />}
                {!copy.copied && <Copy width={14} height={14} aria-hidden />}
              </Button>
            )}
            {user && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                disabled={!canEdit}
                onClick={start}
                aria-label="编辑并在新分支重发"
                title="编辑并在新分支重发"
              >
                <Pencil width={14} height={14} aria-hidden />
              </Button>
            )}
            {copy.copied && <span role="status">已复制</span>}
          </div>
        )}
        {copy.error && <Notice tone="error">{copy.error}</Notice>}
        {editing && (
          <form className="w-full space-y-3" onSubmit={submit}>
            <Label htmlFor={`edit-message-${message.id}`} className="sr-only">
              编辑消息
            </Label>
            <Textarea
              id={`edit-message-${message.id}`}
              value={text}
              maxLength={64_000}
              disabled={pending}
              required
              onChange={changeText}
            />
            {error && <Notice tone="error">{error}</Notice>}
            <McpToolPicker state={mcp} />
            <SkillPicker state={skills} />
            {mcp.blocked && <Notice tone="error">MCP 选择已失效，请重新选择。</Notice>}
            <Button type="button" variant="ghost" onClick={mcp.openPicker} disabled={pending}>
              MCP 工具 · {mcp.selected.length}
            </Button>
            <Button type="button" variant="ghost" onClick={skills.openPicker} disabled={pending}>
              Skills · {skills.selected.length}
            </Button>
            {skills.blocked && <Notice tone="error">Skill 选择已失效，请重新选择。</Notice>}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  pending || mcp.blocked || skills.blocked || !canEdit || text.trim().length === 0
                }
              >
                创建分支并重发
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={cancel}>
                取消编辑
              </Button>
            </div>
          </form>
        )}
      </article>
    );
  },
  (previous, next) => {
    return (
      previous.workspaceId === next.workspaceId &&
      previous.approvalMode === next.approvalMode &&
      previous.message === next.message &&
      previous.failure === next.failure &&
      previous.canEdit === next.canEdit &&
      previous.onEdit === next.onEdit
    );
  },
);
