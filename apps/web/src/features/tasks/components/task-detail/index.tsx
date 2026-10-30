import type { AgentTaskSummary } from '@my-pi-harness/protocol';
import { Square } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { PlanReviewCard } from '@/features/work/components/plan-review-card';
import { QuestionCard } from '@/features/work/components/question-card';
import { ToolCard } from '@/features/sessions/components/tool-card';
import { TaskTranscript } from '@/features/tasks/components/task-transcript';
import { useTaskDetail } from '@/features/tasks/hooks/use-task-detail';
import {
  taskStatusLabel,
  taskTranscriptView,
  type TaskTranscriptView,
} from '@/features/tasks/utils/task-view';
import { requestFailureText } from '@/utils/run-failure';
import { describeError } from '@/utils/describe-error';

interface TaskDetailProps {
  task: AgentTaskSummary;
}

/** Human forms stay outside transcript disclosures and address their original task-owned waits. */
export const TaskDetail: FC<TaskDetailProps> = ({ task }) => {
  const state = useTaskDetail(task);
  const detail = state.query.data;
  let transcript: TaskTranscriptView | undefined;
  let diagnostic: string | null = null;
  if (detail !== undefined) {
    transcript = taskTranscriptView(detail);
    diagnostic = transcript.diagnostic;
  } else if (task.error !== null) diagnostic = requestFailureText(task.error);
  return (
    <section className="min-w-0 space-y-5" aria-label="任务详情">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{task.title}</h3>
          <p className="text-xs text-muted-foreground">
            {task.role.name} · {taskStatusLabel(task)}
          </p>
          <p className="text-xs text-muted-foreground">{state.modelLabel}</p>
        </div>
        {state.canStop && (
          <Button
            type="button"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={state.stopping.run}
            disabled={state.stopping.pending}
          >
            <Square width={12} height={12} aria-hidden />
            停止此任务
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-muted/40 p-3 text-xs">
        <dt className="text-muted-foreground">执行轮数上限</dt>
        <dd>{task.limits.maxTurns}</dd>
        <dt className="text-muted-foreground">已记录 Token</dt>
        <dd>{task.usage?.totalTokens.toLocaleString() ?? '暂无计量'}</dd>
      </dl>
      {state.query.isPending && (
        <p className="text-sm text-muted-foreground" role="status">
          正在读取任务…
        </p>
      )}
      {state.query.isError && <Notice tone="error">{describeError(state.query.error)}</Notice>}
      {state.stopping.error && <Notice tone="error">{state.stopping.error}</Notice>}
      {state.sending.error && <Notice tone="error">{state.sending.error}</Notice>}
      {diagnostic !== null && <Notice tone="error">{diagnostic}</Notice>}
      {detail && (
        <>
          <div className="space-y-3" aria-label="此任务的待处理事项">
            {detail.work.plan?.review === 'pending' && (
              <PlanReviewCard state={detail.work} onCommand={state.command} />
            )}
            {state.pendingQuestions.map((question) => {
              return <QuestionCard key={question.id} question={question} onAnswer={state.answer} />;
            })}
            {state.pendingTools.map((tool) => {
              return <ToolCard key={tool.id} tool={tool} onDecide={state.decide} />;
            })}
          </div>
          {transcript !== undefined && <TaskTranscript view={transcript} onDecide={state.decide} />}
          {(state.cursor > 0 || detail.nextCursor !== null) && (
            <div className="flex justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                disabled={state.cursor === 0}
                onClick={state.previous}
              >
                上一页消息
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={detail.nextCursor === null}
                onClick={state.next}
              >
                下一页消息
              </Button>
            </div>
          )}
        </>
      )}
      {state.canMessage && (
        <form className="space-y-2 border-t border-border/60 pt-4" onSubmit={state.submit}>
          <Label htmlFor={`agent-message-${task.id}`}>补充任务说明</Label>
          <Textarea
            id={`agent-message-${task.id}`}
            value={state.text}
            onChange={state.changeText}
            maxLength={16000}
            className="min-h-20"
            placeholder="补充资料或提出后续要求"
            disabled={state.draftLocked}
          />
          {state.continuing && (
            <p className="text-xs text-muted-foreground">
              继续会创建新的执行，使用该任务已有上下文。
            </p>
          )}
          {state.uncertain && (
            <p className="text-xs text-muted-foreground" role="status">
              尚未确认发送结果。重试会核对原请求，不会重复补充任务说明。
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={state.sending.pending || state.text.trim().length === 0}
            >
              {state.uncertain && '重试确认'}
              {!state.uncertain && !state.continuing && '发送补充'}
              {!state.uncertain && state.continuing && '继续任务'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
};
