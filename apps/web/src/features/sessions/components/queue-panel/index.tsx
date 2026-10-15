import type { QueueInput, QueuePatchInput } from '@my-pi-harness/protocol';
import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { QueueItem } from '@/features/sessions/components/queue-item';
import { useQueueResume } from '@/features/sessions/hooks/use-queue-resume';

interface QueuePanelProps {
  queue: QueueInput[];
  running: boolean;
  onUpdate: (id: string, patch: QueuePatchInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onResume: () => Promise<void>;
}

/** Durable pending inputs remain inspectable after stop, refresh and host recovery. */
export const QueuePanel: FC<QueuePanelProps> = ({
  queue,
  running,
  onUpdate,
  onDelete,
  onResume,
}) => {
  const { run: resume, pending, error } = useQueueResume(onResume);

  return (
    <details className="shrink-0 border-t border-border bg-muted px-4 py-3">
      <summary className="cursor-pointer text-xs font-medium">待执行输入 · {queue.length}</summary>
      <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
        {!running && (
          <div className="space-y-2">
            <Notice>
              这些输入仍然保存在会话中。服务重启或用户停止后，需要明确继续才会发起模型请求。
            </Notice>
            <Button type="button" disabled={pending} onClick={resume}>
              {pending && '恢复中…'}
              {!pending && '继续执行队列'}
            </Button>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <ul className="space-y-2">
          {queue.map((input) => {
            return (
              <QueueItem
                key={`${input.id}:${input.revision}`}
                input={input}
                onUpdate={onUpdate}
                onDelete={onDelete}
              />
            );
          })}
        </ul>
      </div>
    </details>
  );
};
