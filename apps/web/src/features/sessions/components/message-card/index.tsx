import type { EditInput, MessageView } from '@my-pi-harness/protocol';
import { memo, type FC } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { useMessageEditor } from '@/features/sessions/hooks/use-message-editor';
import { Label } from '@/components/ui/label';

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
export const MessageCard: FC<MessageCardProps> = memo(({ message, canEdit, onEdit }) => {
  const { editing, text, changeText, submit, start, cancel, pending, error } = useMessageEditor(
    message,
    onEdit,
  );

  return (
    <article
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-label={`${ROLE_LABELS[message.role]}的消息`}
    >
      <header className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">{ROLE_LABELS[message.role]}</span>
        <Badge>{STATUS_LABELS[message.status]}</Badge>
      </header>
      {message.thinking.length > 0 && (
        <details className="rounded bg-muted p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">推理内容</summary>
          <p className="mt-2 leading-6 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
            {message.thinking}
          </p>
        </details>
      )}
      {!editing && (
        <p className="text-sm leading-7 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
          {message.text}
        </p>
      )}
      {!editing && message.text.length === 0 && message.status === 'streaming' && (
        <p className="text-xs text-muted-foreground">正在等待模型内容…</p>
      )}
      {!editing && message.role === 'user' && (
        <Button type="button" variant="ghost" disabled={!canEdit} onClick={start}>
          编辑并在新分支重发
        </Button>
      )}
      {editing && (
        <form className="space-y-3" onSubmit={submit}>
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
});
