import type { TodoEvidence } from '@/features/work/types/work';
import type { PlanStep, Todo, ToolCallView } from '@my-pi-harness/protocol';

/** Resolves task references against persisted steps and actual successful tool results. */
export const todoEvidence = (
  todo: Todo,
  tools: ToolCallView[],
  steps: PlanStep[],
): TodoEvidence => {
  const linkedStep = steps.find((step) => {
    return step.id === todo.planStepId;
  });
  let step: string | null = null;
  if (linkedStep) {
    step = linkedStep.title;
  }
  return {
    step,
    tools: todo.evidenceToolCallIds.map((id) => {
      const tool = tools.find((entry) => {
        return entry.id === id;
      });
      if (tool) {
        return { id: tool.id, name: tool.name, summary: tool.summary };
      }
      return { id, name: '历史工具调用', summary: id };
    }),
  };
};
