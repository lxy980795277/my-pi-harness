import type { WorkState } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { PlanSteps } from '@/features/work/components/plan-steps';
import { usePlanReview } from '@/features/work/hooks/use-plan-review';
interface PlanReviewCardProps {
  state: WorkState;
  onCommand: (name: string, input: unknown) => Promise<void>;
}
/** Approval resumes the waiting run; feedback asks that run to revise its plan. */
export const PlanReviewCard: FC<PlanReviewCardProps> = ({ state, onCommand }) => {
  const view = usePlanReview(state, onCommand);
  const plan = state.plan;
  if (!plan) {
    return null;
  }
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
      aria-label="计划审核"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{plan.title}</span>
        <Badge>等待审核</Badge>
      </div>
      <div className="max-h-64 overflow-y-auto text-sm leading-7 whitespace-pre-wrap">
        {plan.content}
      </div>
      <PlanSteps steps={plan.steps} />
      <div className="space-y-1">
        <Label htmlFor={`plan-feedback-${plan.id}`} className="sr-only">
          计划修改意见
        </Label>
        <Textarea
          id={`plan-feedback-${plan.id}`}
          value={view.feedback}
          onChange={view.changeFeedback}
          maxLength={4000}
          className="min-h-16"
          placeholder="填写修改意见"
          disabled={view.action.pending}
        />
      </div>
      {view.action.error && <Notice tone="error">{view.action.error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={view.cancel} disabled={view.action.pending}>
          取消审核
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={view.revise}
          disabled={view.action.pending || !view.feedback.trim()}
        >
          提交修改意见
        </Button>
        <Button type="button" onClick={view.approve} disabled={view.action.pending}>
          批准并执行
        </Button>
      </div>
    </div>
  );
};
