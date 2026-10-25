import type { FC } from 'react';
import { PlanReviewCard } from '@/features/work/components/plan-review-card';
import { QuestionCard } from '@/features/work/components/question-card';
import type { WorkView } from '@/features/work/types/work';

interface WorkRequestsProps {
  state: WorkView;
}

/** Pending forms remain mounted in the conversation flow while history rows are virtualized. */
export const WorkRequests: FC<WorkRequestsProps> = ({ state }) => {
  const work = state.query.data;
  if (!state.hasRequests) {
    return null;
  }
  return (
    <div className="space-y-2 pt-2 pb-3">
      {work && state.reviewingPlan && work.state.plan !== null && (
        <PlanReviewCard key={work.state.plan.id} state={work.state} onCommand={state.command} />
      )}
      {state.pendingQuestions.map((question) => {
        return <QuestionCard key={question.id} question={question} onAnswer={state.answer} />;
      })}
    </div>
  );
};
