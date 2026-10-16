import type { PlanReview, WorkState } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent } from 'react';
import type { PlanReviewView } from '@/features/work/types/work';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Decisions address the exact plan and work revision that the user reviewed. */
export const usePlanReview = (
  state: WorkState,
  onCommand: (name: string, input: unknown) => Promise<void>,
): PlanReviewView => {
  const [feedback, setFeedback] = useState('');
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, decision: PlanReview['decision']): Promise<void> => {
        if (!state.plan) {
          return;
        }
        const input: PlanReview = {
          expectedBranchId: state.branchId,
          revision: state.revision,
          decision,
          feedback: feedback.trim(),
        };
        await onCommand(`plans/${encodeURIComponent(state.plan.id)}/review`, input);
        setFeedback('');
      },
      [feedback, onCommand, state.branchId, state.plan, state.revision],
    ),
  );
  const { run } = action;
  const changeFeedback = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setFeedback(event.target.value);
  }, []);
  const approve = useCallback((): void => {
    run('approve');
  }, [run]);
  const revise = useCallback((): void => {
    if (feedback.trim()) {
      run('feedback');
    }
  }, [feedback, run]);
  const cancel = useCallback((): void => {
    run('cancel');
  }, [run]);
  return { feedback, changeFeedback, approve, revise, cancel, action };
};
