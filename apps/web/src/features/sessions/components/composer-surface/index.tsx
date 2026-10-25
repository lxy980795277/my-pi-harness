import { ArrowUp, Square } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { ConversationFooter } from '@/components/conversation-footer';
import { Textarea } from '@/components/ui/textarea';
import { useComposerKeyboard } from '@/features/sessions/hooks/use-composer-keyboard';
import { useAttachmentComposer } from '@/features/attachments/hooks/use-attachment-composer';
import { AttachmentList } from '@/features/attachments/components/attachment-list';
import { SkillPicker } from '@/features/skills/components/skill-picker';
import { McpToolPicker } from '@/features/mcp/components/mcp-tool-picker';
import { ComposerControls } from '@/features/sessions/components/composer-controls';
import type { ComposerSurfaceProps } from '@/features/sessions/types/composer';
import { cn } from '@/utils/cn';

/** A shared rounded surface keeps the empty and ongoing conversation controls consistent. */
export const ComposerSurface: FC<ComposerSurfaceProps> = ({
  id,
  draft,
  changeDraft,
  submit,
  choices,
  pending,
  disabled,
  draftLocked = false,
  running = false,
  stopping = false,
  stop,
  footer = <ConversationFooter />,
  error,
  uncertain = false,
  attachmentDraftKey,
  attachmentIds,
  removeAttachment,
  mcp,
  skills,
}) => {
  const keyboard = useComposerKeyboard();
  const attachment = useAttachmentComposer(
    attachmentDraftKey,
    pending || draftLocked,
    mcp.openPicker,
    skills.openPicker,
  );
  return (
    <form onSubmit={submit} className="w-full space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      {uncertain && (
        <Notice>上次提交结果尚未确认。再次发送会按原消息和请求重试，请先检查对话记录。</Notice>
      )}
      {mcp.blocked && <Notice tone="error">MCP 选择不可用，请打开 MCP 工具选择并重新选择。</Notice>}
      <McpToolPicker state={mcp} />
      <SkillPicker state={skills} />
      {skills.blocked && <Notice tone="error">Skill 选择已失效，请重新选择。</Notice>}
      <div className="rounded-3xl border border-border/50 bg-card p-3 text-card-foreground shadow-[0_6px_32px_-12px_var(--border)] has-[textarea:focus]:border-ring/40">
        <Label htmlFor={`message-draft-${id}`} className="sr-only">
          消息
        </Label>
        <Textarea
          id={`message-draft-${id}`}
          value={draft}
          placeholder="输入任何问题"
          rows={1}
          maxLength={64000}
          disabled={pending || draftLocked}
          onChange={changeDraft}
          onKeyDown={keyboard.keyDown}
          onKeyUp={keyboard.keyUp}
          onCompositionStart={keyboard.compositionStart}
          onCompositionEnd={keyboard.compositionEnd}
          onPaste={attachment.paste}
          className="max-h-48 min-h-12 resize-none rounded-xl border-0 bg-transparent px-2 py-1 text-sm focus-visible:border-transparent focus-visible:ring-0"
        />
        {attachmentIds.length > 0 && (
          <div className="px-2 pt-2">
            <AttachmentList
              ids={attachmentIds}
              onRemove={removeAttachment}
              disabled={pending || draftLocked}
            />
          </div>
        )}
        <div className="mt-2 flex items-end justify-between gap-2">
          <ComposerControls
            id={id}
            choices={choices}
            mcp={mcp}
            skills={skills}
            attachment={{
              state: attachment,
              locked: pending || draftLocked,
            }}
          />
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            {running && stop && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full"
                onClick={stop}
                disabled={stopping}
                aria-label="停止"
                title="停止当前运行"
              >
                <Square width={14} height={14} aria-hidden />
              </Button>
            )}
            {/* Enter submits through this button, including queued input while running. */}
            <Button
              type="submit"
              size="icon"
              className={cn('h-9 w-9 rounded-full', running && 'hidden')}
              disabled={disabled}
              aria-hidden={running}
              aria-label="发送"
              title="Enter 发送，Shift+Enter 换行"
            >
              <ArrowUp width={18} height={18} aria-hidden />
            </Button>
          </div>
        </div>
      </div>
      {footer}
    </form>
  );
};
