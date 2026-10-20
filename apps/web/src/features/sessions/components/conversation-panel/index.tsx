import type { ProviderConfig, RunView } from '@my-pi-harness/protocol';
import { Download, LoaderCircle } from 'lucide-react';
import { memo, type FC } from 'react';

import { WorkPanel } from '@/features/work/components/work-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Composer } from '@/features/sessions/components/composer';
import { MessageTimeline } from '@/features/sessions/components/message-timeline';
import { QueuePanel } from '@/features/sessions/components/queue-panel';
import { useConversation } from '@/features/sessions/hooks/use-conversation';
import { describeError } from '@/utils/describe-error';

interface ConversationPanelProps {
  sessionId: string;
  providers: ProviderConfig[];
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
export const ConversationPanel: FC<ConversationPanelProps> = memo(({ sessionId, providers }) => {
  const {
    query,
    connection,
    connectionError,
    commands,
    snapshot,
    lastRun,
    download,
    downloading,
    error,
    reload,
  } = useConversation(sessionId);

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
          <header
            className="flex w-full shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-3 sm:px-6"
            aria-label="会话标题栏"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="truncate text-sm font-semibold">{snapshot.session.title}</h1>
              {connection !== 'connected' && (
                <p className="text-[11px] text-muted-foreground">{CONNECTION_LABELS[connection]}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {lastRun && lastRun.status !== 'completed' && (
                <Badge>{RUN_LABELS[lastRun.status]}</Badge>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-2 rounded-full px-3 text-xs"
                disabled={downloading}
                aria-label="下载对话日志"
                aria-busy={downloading}
                onClick={download}
              >
                {!downloading && <Download width={14} height={14} aria-hidden />}
                {downloading && (
                  <LoaderCircle
                    width={14}
                    height={14}
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                )}
                <span>对话日志</span>
                {downloading && <span className="sr-only">正在下载</span>}
              </Button>
            </div>
          </header>
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
          {error && (
            <div className="px-4 pt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          {lastRun?.error && (
            <div className="px-4 pt-3">
              <Notice tone="error">{lastRun.error}</Notice>
            </div>
          )}
          {lastRun?.status === 'interrupted' && (
            <div className="px-4 pt-3">
              <Notice>上次运行因服务退出而中断，已保存内容仍可阅读；继续需要新的明确操作。</Notice>
            </div>
          )}
          <MessageTimeline
            key={snapshot.session.activeBranchId}
            messages={snapshot.messages}
            tools={snapshot.tools}
            runs={snapshot.runs}
            branchId={snapshot.session.activeBranchId}
            activeRunId={snapshot.session.activeRunId}
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
          <WorkPanel key={`${sessionId}:${snapshot.session.activeBranchId}`} session={snapshot}>
            <Composer
              session={snapshot.session}
              providers={providers}
              onSend={commands.send}
              onStop={commands.stop}
              onPatch={commands.patch}
            />
          </WorkPanel>
        </>
      )}
    </section>
  );
});
