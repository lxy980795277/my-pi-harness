import type { PlanReview, WorkState } from '@my-pi-harness/protocol';
import { useCallback, type ChangeEvent } from 'react';
import { useWorkDraftStore } from '@/features/work/stores/drafts';
import type { PlanReviewView } from '@/features/work/types/work';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Decisions address the exact plan and work revision that the user reviewed. */
export const usePlanReview = (
  state: WorkState,
  onCommand: (name: string, input: unknown) => Promise<void>,
): PlanReviewView => {
  const planId = state.plan?.id;
  const draft = useWorkDraftStore((store) => {
    if (planId === undefined) return undefined;
    return store.feedback[planId];
  });
  const feedback = draft ?? '';
  const setFeedback = useWorkDraftStore((store) => {
    return store.setFeedback;
  });
  const clear = useWorkDraftStore((store) => {
    return store.clearFeedback;
  });
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
        clear(state.plan.id);
      },
      [clear, feedback, onCommand, state.branchId, state.plan, state.revision],
    ),
  );
  const { run } = action;
  const changeFeedback = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      if (planId !== undefined) setFeedback(planId, event.target.value);
    },
    [planId, setFeedback],
  );
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
