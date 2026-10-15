import type { QueueInput, QueuePatchInput } from '@my-pi-harness/protocol';
import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { useQueueItem } from '@/features/sessions/hooks/use-queue-item';
import { Label } from '@/components/ui/label';

interface QueueItemProps {
  input: QueueInput;
  onUpdate: (id: string, patch: QueuePatchInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Queue edits carry the observed revision; accepted input is never a local-only row. */
export const QueueItem: FC<QueueItemProps> = ({ input, onUpdate, onDelete }) => {
  const { editing, text, changeText, start, cancel, update, remove, pending, error } = useQueueItem(
    input,
    onUpdate,
    onDelete,
  );

  return (
    <li className="space-y-2 rounded border border-border bg-background p-3">
      <p className="text-[11px] text-muted-foreground">
        {input.mode === 'steer' && '引导输入'}
        {input.mode === 'follow-up' && '后续输入'} · {input.modelId}
      </p>
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
            disabled={pending || text.trim().length === 0}
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
