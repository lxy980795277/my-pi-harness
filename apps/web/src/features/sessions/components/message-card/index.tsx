import type { EditInput, MessageView } from '@my-pi-harness/protocol';
import { Atom, Check, ChevronRight, Copy, LoaderCircle, Pencil } from 'lucide-react';
import { memo, type FC } from 'react';

import { Markdown } from '@/components/markdown';
import { AttachmentList } from '@/features/attachments/components/attachment-list';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { useMessageEditor } from '@/features/sessions/hooks/use-message-editor';
import { reasoningPreview } from '@/features/sessions/utils/reasoning-preview';
import { useCopyText } from '@/hooks/use-copy-text';
import { Label } from '@/components/ui/label';
import { cn } from '@/utils/cn';

interface MessageCardProps {
  message: MessageView;
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

/** Displays only public text/thinking; an edit creates a new branch rather than replacing this fact. */
export const MessageCard: FC<MessageCardProps> = memo(
  ({ message, canEdit, onEdit }) => {
    const { editing, text, changeText, submit, start, cancel, pending, error } = useMessageEditor(
      message,
      onEdit,
    );
    const copy = useCopyText(message.text);
    const streaming = message.status === 'streaming';
    const user = message.role === 'user';

    return (
      <article
        className={cn('group min-w-0 space-y-3', user && 'flex flex-col items-end')}
        aria-label={`${ROLE_LABELS[message.role]}的消息`}
      >
        {message.thinking.length > 0 && (
          <details className="group/thinking min-w-0 text-muted-foreground">
            <summary
              className="group/reasoning flex w-full min-w-0 cursor-pointer list-none items-center gap-2 rounded py-1 text-sm focus-visible:bg-muted/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
              aria-label="思考内容"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <Atom
                  width={15}
                  height={15}
                  className="group-hover/thinking:hidden group-focus-visible/reasoning:hidden"
                  aria-hidden
                />
                <ChevronRight
                  width={15}
                  height={15}
                  className="hidden group-open/thinking:rotate-90 group-hover/thinking:block group-focus-visible/reasoning:block"
                  aria-hidden
                />
              </span>
              <span className="shrink-0">思考</span>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{reasoningPreview(message.thinking)}</span>
            </summary>
            <div className="mt-2 rounded-lg bg-muted/40 px-4 py-3">
              <Markdown text={message.thinking} streaming={streaming} className="text-sm" />
            </div>
          </details>
        )}
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
          <div className="flex min-h-7 flex-wrap items-center gap-x-0 gap-y-1 text-xs text-muted-foreground">
            {streaming && (
              <LoaderCircle
                width={13}
                height={13}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            )}
            {message.status !== 'complete' && (
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
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || !canEdit || text.trim().length === 0}>
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
      previous.message === next.message &&
      previous.canEdit === next.canEdit &&
      previous.onEdit === next.onEdit
    );
  },
);
