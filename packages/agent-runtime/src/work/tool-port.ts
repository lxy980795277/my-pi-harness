import type { WorkToolHandlers } from '@my-pi-harness/tools';
import { RuntimeError } from '../errors';
import type { WorkRuntime } from './runtime';

/** Bind interaction state to the exact root or task Run, never the parent context. */
export function createWorkToolHandlers(
  work: WorkRuntime,
  sessionId: string,
  runId: string,
): WorkToolHandlers {
  return {
    ask: (questions, i) => work.ask(sessionId, runId, i.toolCallId, questions, i.signal),
    proposePlan: (input, i) =>
      work.proposePlan(sessionId, runId, input.title, input.content, input.steps, i.signal),
    updatePlanSteps: (steps) => {
      const state = work.snapshot(sessionId).state;
      if (!state.plan || state.plan.review !== 'approved' || state.plan.status === 'draft')
        throw new RuntimeError('PLAN_NOT_APPROVED', '请先提交并批准计划。');
      const approvedPlan = state.plan;
      if (
        new Set(steps.map(({ id }) => id)).size !== steps.length ||
        steps.some(({ id }) => !approvedPlan.steps.some((step) => step.id === id))
      )
        throw new RuntimeError('PLAN_STEP_INVALID', '计划步骤不存在或重复。');
      const next = approvedPlan.steps.map((step) => {
        const update = steps.find(({ id }) => id === step.id);
        if (update === undefined) return step;
        return { ...step, status: update.status };
      });
      if (next.filter(({ status }) => status === 'in_progress').length > 1)
        throw new RuntimeError('PLAN_STEP_INVALID', '最多一个计划步骤处于进行中。');
      work.save(
        sessionId,
        {
          ...state,
          plan: {
            ...state.plan,
            steps: next,
            status: next.every(({ status }) => status === 'completed') ? 'completed' : 'approved',
            updatedAt: Date.now(),
          },
        },
        runId,
      );
      return '计划步骤已更新。';
    },
    updateTodos: (todos) => {
      const state = work.snapshot(sessionId).state;
      work.validateTodos(sessionId, todos, runId);
      work.save(sessionId, { ...state, todos }, runId);
      return '任务清单已保存。';
    },
    searchHistory: (query, limit) => work.searchHistory(sessionId, query, limit),
    readToolResult: (id, offset, maximum) => work.readToolResult(sessionId, id, offset, maximum),
  };
}
