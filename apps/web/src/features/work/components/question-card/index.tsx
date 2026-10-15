import type { Question } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { QuestionOption } from '@/features/work/components/question-option';
import { useQuestion } from '@/features/work/hooks/use-question';
import { QUESTION_STATUS_LABELS } from '@/features/work/utils/work-view';
interface QuestionCardProps {
  question: Question;
  onAnswer: (id: string, value: string | null) => Promise<void>;
}
/** Pending human questions stay visible outside the work dialog while the agent waits. */
export const QuestionCard: FC<QuestionCardProps> = ({ question, onAnswer }) => {
  const state = useQuestion(question, onAnswer);
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
      aria-label="Agent 提问"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{question.prompt}</span>
        <Badge>{QUESTION_STATUS_LABELS[question.status]}</Badge>
      </div>
      {question.status === 'pending' && (
        <form className="space-y-3" onSubmit={state.submit}>
          <div className="flex flex-wrap gap-2">
            {question.options.map((value) => {
              return (
                <QuestionOption
                  key={value}
                  value={value}
                  selected={state.answer === value}
                  onSelect={state.choose}
                  disabled={state.action.pending}
                />
              );
            })}
          </div>
          <Label htmlFor={`question-${question.id}`} className="sr-only">
            回答 Agent
          </Label>
          <Textarea
            id={`question-${question.id}`}
            value={state.answer}
            onChange={state.change}
            maxLength={4000}
            placeholder="输入回答，也可以补充说明"
            className="min-h-20"
            disabled={state.action.pending}
          />
          {state.action.error && <Notice tone="error">{state.action.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={state.action.pending}
              onClick={state.cancel}
            >
              取消提问
            </Button>
            <Button type="submit" disabled={state.action.pending || !state.answer.trim()}>
              提交回答
            </Button>
          </div>
        </form>
      )}
      {question.answer && (
        <div className="text-sm leading-6 whitespace-pre-wrap">{question.answer}</div>
      )}
    </div>
  );
};
