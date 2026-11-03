import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { PlanStepSchema, QuestionItemSchema, TodoSchema } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';
import type { WorkRuntime } from './runtime.js';

const ask = Type.Object(
  { questions: Type.Array(QuestionItemSchema, { minItems: 1, maxItems: 12 }) },
  { additionalProperties: false },
);
const plan = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    content: Type.String({ minLength: 1, maxLength: 32_000 }),
    steps: Type.Array(PlanStepSchema, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);
const steps = Type.Object(
  {
    steps: Type.Array(Type.Pick(PlanStepSchema, ['id', 'status']), { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);
const todos = Type.Object(
  { todos: Type.Array(TodoSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);
const search = Type.Object(
  {
    query: Type.String({ minLength: 2, maxLength: 200 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { additionalProperties: false },
);
const readResult = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 160 }),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 128_000 })),
    maxCharacters: Type.Optional(Type.Integer({ minimum: 1, maximum: 6000 })),
  },
  { additionalProperties: false },
);

/** Session tools manage context and interaction without granting workspace access or skipping approvals. */
export const SESSION_TOOL_DEFINITIONS = [
  {
    name: 'ask_user',
    description:
      'Ask one or more structured questions and wait for the user. Use stable question and option IDs, descriptions, explicit single/multiple selection, and custom-input permission.',
    parameters: ask,
  },
  {
    name: 'update_plan',
    description:
      'Submit a structured plan for user review and suspend this tool. Approval continues the same Run in execution mode; feedback requires a revised submission. Tool permissions remain separate.',
    parameters: plan,
  },
  {
    name: 'update_plan_steps',
    description:
      'Update step statuses in an already approved plan. Preserve step IDs; at most one step may be in progress. This cannot change plan contents or approve a plan.',
    parameters: steps,
  },
  {
    name: 'update_todos',
    description:
      'Replace visible tasks using stable IDs and optional plan-step links. Completed tasks require successful tool evidence from this Run, or an explicit completionNote for a textual conclusion. Never mark an unobserved action complete.',
    parameters: todos,
  },
  {
    name: 'search_session_history',
    description:
      'Search bounded original messages and retained tool text in this session selected branch, including compacted history. Tool matches provide a record id and offset for read_tool_result. This does not search other sessions or long-term memory.',
    parameters: search,
  },
  {
    name: 'read_tool_result',
    description:
      'Read a bounded page of retained text from a finished tool in this selected branch or agent task, including failed results. Use the retained record id from a context reference or search_session_history, then follow the returned next-page call. This does not repeat the original tool or recover text omitted by its output limit.',
    parameters: readResult,
  },
] satisfies readonly { name: string; description: string; parameters: TSchema }[];

/** Execute model JSON after validation; each result is logged by the common tool owner. */
export async function executeSessionTool(
  work: WorkRuntime,
  sessionId: string,
  runId: string,
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (name === 'ask_user' && Value.Check(ask, args))
    return await work.ask(sessionId, runId, toolCallId, args.questions, signal);
  if (name === 'update_plan' && Value.Check(plan, args))
    return await work.proposePlan(sessionId, runId, args.title, args.content, args.steps, signal);
  const state = work.snapshot(sessionId).state;
  if (name === 'update_plan_steps' && Value.Check(steps, args)) {
    if (!state.plan || state.plan.review !== 'approved' || state.plan.status === 'draft')
      throw new RuntimeError('PLAN_NOT_APPROVED', '请先提交并批准计划。');
    const approvedPlan = state.plan;
    if (
      new Set(args.steps.map(({ id }) => id)).size !== args.steps.length ||
      args.steps.some(({ id }) => !approvedPlan.steps.some((step) => step.id === id))
    )
      throw new RuntimeError('PLAN_STEP_INVALID', '计划步骤不存在或重复。');
    const next = approvedPlan.steps.map((step) => {
      const update = args.steps.find(({ id }) => id === step.id);
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
  }
  if (name === 'update_todos' && Value.Check(todos, args)) {
    work.validateTodos(sessionId, args.todos, runId);
    work.save(sessionId, { ...state, todos: args.todos }, runId);
    return '任务清单已保存。';
  }
  if (name === 'search_session_history' && Value.Check(search, args))
    return work.searchHistory(sessionId, args.query, args.limit ?? 10);
  if (name === 'read_tool_result' && Value.Check(readResult, args))
    return work.readToolResult(
      sessionId,
      args.toolCallId,
      args.offset ?? 0,
      args.maxCharacters ?? 6000,
    );
  throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '会话工具参数无效。');
}
