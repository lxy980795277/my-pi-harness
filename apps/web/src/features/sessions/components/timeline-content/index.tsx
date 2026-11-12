import type {
  ApprovalMode,
  EditInput,
  MessageView,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import { memo, type FC } from 'react';
import { MessageCard } from '@/features/sessions/components/message-card';
import { MessageThinking } from '@/components/message-thinking';
import { ToolCard } from '@/features/sessions/components/tool-card';
import type { TimelineContentEntry } from '@/features/sessions/types/session';
import type { MessageElementRef } from '@/features/sessions/types/timeline-target';

interface TimelineContentProps {
  entry: TimelineContentEntry;
  workspaceId: string | null;
  onSaveMemory: (message: MessageView) => void;
  onMessageElement: MessageElementRef;
  approvalMode: ApprovalMode;
  canEdit: boolean;
  onEdit: (input: EditInput) => Promise<void>;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Use the same content components for live rows and completed answer processes. */
export const TimelineContent: FC<TimelineContentProps> = memo(
  ({
    entry,
    workspaceId,
    onSaveMemory,
    onMessageElement,
    approvalMode,
    canEdit,
    onEdit,
    onDecide,
  }) => {
    if (entry.type === 'tool') return <ToolCard tool={entry.tool} onDecide={onDecide} />;
    if (entry.part === 'thinking') {
      return (
        <MessageThinking
          text={entry.message.thinking}
          streaming={entry.message.status === 'streaming'}
        />
      );
    }
    return (
      <MessageCard
        workspaceId={workspaceId}
        onSaveMemory={onSaveMemory}
        onMessageElement={onMessageElement}
        approvalMode={approvalMode}
        message={entry.message}
        failure={entry.failure ?? null}
        canEdit={canEdit}
        onEdit={onEdit}
      />
    );
  },
);
