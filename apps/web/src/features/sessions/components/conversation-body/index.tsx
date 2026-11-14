import type { ProviderConfig, RunView, SessionSnapshot } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Composer } from '@/features/sessions/components/composer';
import { MessageTimeline } from '@/features/sessions/components/message-timeline';
import { QueuePanel } from '@/features/sessions/components/queue-panel';
import type { SessionCommands } from '@/features/sessions/hooks/use-session-commands';
import { WorkPanel } from '@/features/work/components/work-panel';
import { WorkRequests } from '@/features/work/components/work-requests';
import { useWork } from '@/features/work/hooks/use-work';
import { ArchiveAccess } from '@/features/archives/components/archive-access';
import { useSessionExecutionAccess } from '@/features/archives/hooks/use-archive-access';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { describeError } from '@/utils/describe-error';

interface ConversationBodyProps {
  snapshot: SessionSnapshot;
  providers: ProviderConfig[];
  lastRun: RunView | undefined;
  commands: SessionCommands;
}

/** One work query supplies inline requests and the fixed composer footer for this branch. */
export const ConversationBody: FC<ConversationBodyProps> = ({
  snapshot,
  providers,
  lastRun,
  commands,
}) => {
  const work = useWork(snapshot);
  const access = useSessionExecutionAccess(snapshot.session.id);
  return (
    <>
      <MessageTimeline
        sessionId={snapshot.session.id}
        snapshotSeq={snapshot.snapshotSeq}
        liveRevision={snapshot.liveRevision}
        workspaceId={snapshot.session.workspaceId}
        approvalMode={snapshot.session.approvalMode}
        messages={snapshot.messages}
        tools={snapshot.tools}
        runs={snapshot.runs}
        branchId={snapshot.session.activeBranchId}
        activeRunId={snapshot.session.activeRunId}
        canEdit={access.canExecute && snapshot.session.activeRunId === null}
        onEdit={commands.edit}
        onDecide={commands.decide}
      >
        {access.canExecute && <WorkRequests state={work} />}
      </MessageTimeline>
      {access.canExecute && snapshot.queue.length > 0 && (
        <QueuePanel
          workspaceId={snapshot.session.workspaceId}
          approvalMode={snapshot.session.approvalMode}
          queue={snapshot.queue}
          running={snapshot.session.activeRunId !== null}
          onUpdate={commands.updateQueue}
          onDelete={commands.deleteQueue}
          onResume={commands.resume}
        />
      )}
      {access.query.isPending && (
        <p className="shrink-0 px-6 py-4 text-center text-xs text-muted-foreground" role="status">
          正在确认会话执行权限…
        </p>
      )}
      {access.query.isError && (
        <div className="space-y-2 px-6 py-4">
          <Notice tone="error">{describeError(access.query.error)}</Notice>
          <Button type="button" variant="outline" onClick={access.refresh}>
            重新读取执行权限
          </Button>
        </div>
      )}
      {access.query.data?.bound === false && <ArchiveAccess sessionId={snapshot.session.id} />}
      {access.canExecute && (
        <WorkPanel session={snapshot} state={work}>
          <Composer
            session={snapshot.session}
            activeRun={lastRun}
            providers={providers}
            onSend={commands.send}
            onStop={commands.stop}
            onPatch={commands.patch}
          />
        </WorkPanel>
      )}
    </>
  );
};
