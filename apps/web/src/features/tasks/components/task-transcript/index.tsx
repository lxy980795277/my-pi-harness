import type { ToolDecisionInput } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Markdown } from '@/components/markdown';
import { MessageThinking } from '@/components/message-thinking';
import { RequestFailure } from '@/components/request-failure';
import { ToolCard } from '@/features/sessions/components/tool-card';
import type { TaskTranscriptView } from '@/features/tasks/utils/task-view';

interface TaskTranscriptProps {
  view: TaskTranscriptView;
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** Child transcripts are mounted only for the selected task and retain existing tool disclosure UI. */
export const TaskTranscript: FC<TaskTranscriptProps> = ({ view, onDecide }) => {
  return (
    <div className="space-y-6" aria-label="子任务消息">
      {view.rows.map((row) => {
        return (
          <div key={row.message.id} className="min-w-0 space-y-2">
            {row.message.role === 'user' && row.message.agentMessageId === undefined && (
              <p className="text-xs text-muted-foreground">任务输入</p>
            )}
            {row.message.agentMessageId !== undefined && (
              <p className="text-xs text-muted-foreground">任务通信</p>
            )}
            {row.message.thinking.length > 0 && (
              <MessageThinking
                text={row.message.thinking}
                streaming={row.message.status === 'streaming'}
              />
            )}
            {row.message.text.length > 0 && (
              <Markdown text={row.message.text} streaming={row.message.status === 'streaming'} />
            )}
            {row.failure !== null && <RequestFailure text={row.failure} />}
            {row.tools.map((tool) => {
              return <ToolCard key={tool.id} tool={tool} onDecide={onDecide} />;
            })}
          </div>
        );
      })}
      {view.fallbacks.map((failure) => {
        return <RequestFailure key={failure.id} text={failure.text} />;
      })}
    </div>
  );
};
