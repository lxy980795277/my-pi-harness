import type { FC } from 'react';
import { Notice } from '@/components/ui/notice';
import { ConversationPanel } from '@/features/sessions/components/conversation-panel';
import { NewConversation } from '@/features/sessions/components/new-conversation';
import { useSessionsWorkspace } from '@/features/sessions/hooks/use-sessions-workspace';
import { describeError } from '@/utils/describe-error';

/** A shared, bounded workspace: navigation, scrolling timeline and fixed composer. */
export const SessionsPage: FC<{ userName: string }> = ({ userName }) => {
  const { activeId, generation, providersQuery, created } = useSessionsWorkspace();

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {providersQuery.isError && (
          <div className="p-6">
            <Notice tone="error">{describeError(providersQuery.error)}</Notice>
          </div>
        )}
        {!activeId && providersQuery.data && (
          <div className="min-h-0 flex-1">
            <NewConversation
              key={generation}
              providers={providersQuery.data}
              onCreated={created}
              userName={userName}
            />
          </div>
        )}
        {activeId && providersQuery.data && (
          <ConversationPanel key={activeId} sessionId={activeId} providers={providersQuery.data} />
        )}
      </div>
    </div>
  );
};
