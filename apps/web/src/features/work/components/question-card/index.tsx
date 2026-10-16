import type { Question, QuestionResponse } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { QuestionOption } from '@/features/work/components/question-option';
import { useQuestion } from '@/features/work/hooks/use-question';
import { questionAnswerLabel } from '@/features/work/utils/question-answers';
import { QUESTION_STATUS_LABELS } from '@/features/work/utils/work-view';
interface QuestionCardProps {
  question: Question;
  onAnswer: (id: string, value: QuestionResponse[] | null) => Promise<void>;
}
/** A paged form keeps a multi-question request compact while preserving earlier selections. */
export const QuestionCard: FC<QuestionCardProps> = ({ question, onAnswer }) => {
  const state = useQuestion(question, onAnswer);
  const current = state.current;
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
      aria-label="Agent 提问"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Agent 提问</span>
        <Badge>{QUESTION_STATUS_LABELS[question.status]}</Badge>
      </div>
      {question.status === 'pending' && current && (
        <form className="space-y-3" onSubmit={state.submit}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{current.header}</span>
            <span>
              {state.index + 1} / {question.questions.length}
            </span>
            {current.multiSelect && <span>可多选</span>}
          </div>
          <div className="text-sm leading-6 whitespace-pre-wrap">{current.prompt}</div>
          <div className="space-y-1">
            {current.options.map((option) => {
              return (
                <QuestionOption
                  key={option.id}
                  option={option}
                  selected={state.selected.includes(option.id)}
                  onSelect={state.choose}
                  disabled={state.action.pending}
                />
              );
            })}
          </div>
          {current.allowCustomInput && (
            <div className="space-y-1">
              <Label htmlFor={`question-${question.id}-${current.id}`} className="sr-only">
                回答 Agent
              </Label>
              <Textarea
                id={`question-${question.id}-${current.id}`}
                value={state.text}
                onChange={state.change}
                maxLength={4000}
                placeholder="输入回答或补充说明"
                className="min-h-16"
                disabled={state.action.pending}
              />
            </div>
          )}
          {state.action.error && <Notice tone="error">{state.action.error}</Notice>}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={state.action.pending}
              onClick={state.cancel}
            >
              取消提问
            </Button>
            <div className="flex gap-2">
              {state.index > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={state.previous}
                  disabled={state.action.pending}
                >
                  上一题
                </Button>
              )}
              {!state.last && (
                <Button
                  type="button"
                  onClick={state.next}
                  disabled={state.action.pending || !state.currentValid}
                >
                  下一题
                </Button>
              )}
              {state.last && (
                <Button type="submit" disabled={state.action.pending || !state.valid}>
                  提交回答
                </Button>
              )}
            </div>
          </div>
        </form>
      )}
      {question.status !== 'pending' &&
        question.questions.map((item) => {
          return (
            <div key={item.id} className="space-y-1 text-sm leading-6">
              <span className="font-medium">
                {item.header} · {item.prompt}
              </span>
              <div className="whitespace-pre-wrap text-muted-foreground">
                {questionAnswerLabel(item, question.answers)}
              </div>
            </div>
          );
        })}
    </div>
  );
};
