import type { ProviderConfig, RunView } from '@my-pi-harness/protocol';
import { memo, type FC } from 'react';

import { WorkPanel } from '@/features/work/components/work-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { Label } from '@/components/ui/label';
import { Composer } from '@/features/sessions/components/composer';
import { MessageTimeline } from '@/features/sessions/components/message-timeline';
import { QueuePanel } from '@/features/sessions/components/queue-panel';
import { SessionSettings } from '@/features/sessions/components/session-settings';
import { useConversation } from '@/features/sessions/hooks/use-conversation';
import { describeError } from '@/utils/describe-error';

interface ConversationPanelProps {
  sessionId: string;
  providers: ProviderConfig[];
  onDeleted: () => void;
}

const RUN_LABELS: Record<RunView['status'], string> = {
  running: '运行中',
  completed: '已完成',
  cancelled: '已停止',
  failed: '运行失败',
  interrupted: '服务中断',
};
const CONNECTION_LABELS = {
  connecting: '正在连接事件',
  connected: '实时已连接',
  disconnected: '事件断线 · 正在重连',
} as const;

/** Coordinates the selected durable branch without duplicating it into a local Store. */
export const ConversationPanel: FC<ConversationPanelProps> = memo(
  ({ sessionId, providers, onDeleted }) => {
    const {
      query,
      connection,
      connectionError,
      commands,
      snapshot,
      lastRun,
      branchOptions,
      branch,
      branchPending,
      branchError,
      confirmDelete,
      openDelete,
      cancelDelete,
      remove,
      deletePending,
      reload,
    } = useConversation(sessionId, onDeleted);

    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label="当前会话">
        {query.isPending && (
          <div className="p-6">
            <Notice>正在加载会话…</Notice>
          </div>
        )}
        {query.isError && (
          <div className="space-y-3 p-6">
            <Notice tone="error">{describeError(query.error)}</Notice>
            <Button type="button" variant="outline" onClick={reload}>
              重新加载
            </Button>
          </div>
        )}
        {snapshot && (
          <>
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div className="min-w-0 space-y-1">
                <h1 className="truncate text-sm font-semibold">{snapshot.session.title}</h1>
                <p className="text-[11px] text-muted-foreground">{CONNECTION_LABELS[connection]}</p>
              </div>
              <div className="flex items-center gap-2">
                {lastRun && <Badge>{RUN_LABELS[lastRun.status]}</Badge>}
                <Label htmlFor={`session-branch-${sessionId}`} className="sr-only">
                  历史分支
                </Label>
                <SelectField
                  id={`session-branch-${sessionId}`}
                  className="h-8 w-32 text-xs"
                  value={snapshot.session.activeBranchId}
                  disabled={branchPending || snapshot.session.activeRunId !== null}
                  onValueChange={branch}
                  options={branchOptions}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={snapshot.session.activeRunId !== null}
                  onClick={openDelete}
                >
                  删除会话
                </Button>
              </div>
            </header>
            <SessionSettings
              key={`${sessionId}:${snapshot.session.providerId}:${snapshot.session.modelId}:${snapshot.session.thinkingLevel}:${snapshot.session.title}`}
              session={snapshot.session}
              providers={providers}
              onPatch={commands.patch}
            />
            <WorkPanel key={`${sessionId}:${snapshot.session.activeBranchId}`} session={snapshot} />
            {confirmDelete && (
              <div className="px-4 pt-3">
                <Notice>
                  此会话将归档并从列表移除，已保存的执行历史仍保留在本机。
                  <div className="mt-2 flex gap-2">
                    <Button type="button" disabled={deletePending} onClick={remove}>
                      确认删除会话
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={deletePending}
                      onClick={cancelDelete}
                    >
                      取消
                    </Button>
                  </div>
                </Notice>
              </div>
            )}
            {connectionError && (
              <div className="px-4 pt-3">
                <Notice tone="error">{connectionError}</Notice>
              </div>
            )}
            {connection === 'disconnected' && (
              <div className="px-4 pt-3">
                <Notice>事件连接断开不会停止后台运行。重连后将读取已提交状态。</Notice>
              </div>
            )}
            {branchError && (
              <div className="px-4 pt-3">
                <Notice tone="error">{branchError}</Notice>
              </div>
            )}
            {lastRun?.error && (
              <div className="px-4 pt-3">
                <Notice tone="error">{lastRun.error}</Notice>
              </div>
            )}
            {lastRun?.status === 'interrupted' && (
              <div className="px-4 pt-3">
                <Notice>
                  上次运行因服务退出而中断，已保存内容仍可阅读；继续需要新的明确操作。
                </Notice>
              </div>
            )}
            <MessageTimeline
              key={snapshot.session.activeBranchId}
              messages={snapshot.messages}
              tools={snapshot.tools}
              canEdit={snapshot.session.activeRunId === null}
              onEdit={commands.edit}
              onDecide={commands.decide}
            />
            {snapshot.queue.length > 0 && (
              <QueuePanel
                queue={snapshot.queue}
                running={snapshot.session.activeRunId !== null}
                onUpdate={commands.updateQueue}
                onDelete={commands.deleteQueue}
                onResume={commands.resume}
              />
            )}
            <Composer
              session={snapshot.session}
              providers={providers}
              onSend={commands.send}
              onStop={commands.stop}
              onPatch={commands.patch}
            />
          </>
        )}
      </section>
    );
  },
);
