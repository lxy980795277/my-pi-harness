import { ArrowUp, Square } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';
import { useComposerKeyboard } from '@/features/sessions/hooks/use-composer-keyboard';
import { useAttachmentComposer } from '@/features/attachments/hooks/use-attachment-composer';
import { AttachmentList } from '@/features/attachments/components/attachment-list';
import { ComposerControls } from '@/features/sessions/components/composer-controls';
import type { ComposerSurfaceProps } from '@/features/sessions/types/composer';

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
  mode,
  modeOptions,
  changeMode,
  error,
  uncertain = false,
  attachmentDraftKey,
  attachmentIds,
  removeAttachment,
}) => {
  const keyboard = useComposerKeyboard();
  const attachment = useAttachmentComposer(attachmentDraftKey, pending || draftLocked);
  return (
    <form onSubmit={submit} className="w-full space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      {uncertain && (
        <Notice>上次提交结果尚未确认。点击发送会按原消息和请求重试，请先检查对话记录。</Notice>
      )}
      <div className="rounded-3xl border border-border/50 bg-card p-3 text-card-foreground shadow-[0_6px_32px_-12px_var(--border)] has-[textarea:focus]:border-ring/40">
        <Label htmlFor={`message-draft-${id}`} className="sr-only">
          消息
        </Label>
        <Textarea
          id={`message-draft-${id}`}
          value={draft}
          placeholder="输入任何问题"
          maxLength={64000}
          disabled={pending || draftLocked}
          onChange={changeDraft}
          onKeyDown={keyboard.keyDown}
          onKeyUp={keyboard.keyUp}
          onCompositionStart={keyboard.compositionStart}
          onCompositionEnd={keyboard.compositionEnd}
          onPaste={attachment.paste}
          className="max-h-64 min-h-28 resize-none rounded-xl border-0 bg-transparent px-2 py-1 text-sm focus-visible:border-transparent focus-visible:ring-0"
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
        <div className="mt-3 flex items-end justify-between gap-2">
          <ComposerControls
            id={id}
            choices={choices}
            attachment={{
              state: attachment,
              locked: pending || draftLocked,
            }}
          />
          <div className="flex shrink-0 items-center gap-2">
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
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 rounded-full"
              disabled={disabled}
              aria-label="发送"
              title="Enter 发送，Shift+Enter 换行"
            >
              <ArrowUp width={18} height={18} aria-hidden />
            </Button>
          </div>
        </div>
      </div>
      {running && mode && modeOptions && changeMode && (
        <div className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
          <span>运行中输入</span>
          <SelectField
            id={`${id}-input-mode`}
            ariaLabel="运行中输入策略"
            value={mode}
            options={modeOptions}
            onValueChange={changeMode}
            disabled={pending || draftLocked}
            className="h-7 w-auto max-w-52 text-[11px]"
          />
        </div>
      )}
    </form>
  );
};
