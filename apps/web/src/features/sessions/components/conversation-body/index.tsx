import type { ProviderConfig, RunView, SessionSnapshot } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Composer } from '@/features/sessions/components/composer';
import { MessageTimeline } from '@/features/sessions/components/message-timeline';
import { QueuePanel } from '@/features/sessions/components/queue-panel';
import type { SessionCommands } from '@/features/sessions/hooks/use-session-commands';
import { WorkPanel } from '@/features/work/components/work-panel';
import { WorkRequests } from '@/features/work/components/work-requests';
import { useWork } from '@/features/work/hooks/use-work';

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
  return (
    <>
      <MessageTimeline
        workspaceId={snapshot.session.workspaceId}
        approvalMode={snapshot.session.approvalMode}
        messages={snapshot.messages}
        tools={snapshot.tools}
        runs={snapshot.runs}
        branchId={snapshot.session.activeBranchId}
        activeRunId={snapshot.session.activeRunId}
        canEdit={snapshot.session.activeRunId === null}
        onEdit={commands.edit}
        onDecide={commands.decide}
      >
        <WorkRequests state={work} />
      </MessageTimeline>
      {snapshot.queue.length > 0 && (
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
    </>
  );
};
