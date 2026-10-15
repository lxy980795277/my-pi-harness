import { Type, type TSchema } from 'typebox';
import { TodoSchema } from '@my-pi-harness/protocol';
import { RuntimeError } from './errors.js';
import type { WorkRuntime } from './work-runtime.js';

/** Session tools do not grant access to a workspace or bypass execution approvals. */
export const SESSION_TOOL_DEFINITIONS = [
  {
    name: 'ask_user',
    description:
      'Ask the user a question and wait for their answer. Optional choices help clarify a decision; free text is always accepted.',
    parameters: Type.Object(
      {
        prompt: Type.String({ minLength: 1, maxLength: 4000 }),
        options: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 8 }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: 'update_plan',
    description:
      'Create or revise the visible session plan. A revision requires fresh user approval and does not authorize file changes.',
    parameters: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1, maxLength: 32_000 }),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: 'update_todos',
    description:
      'Replace the visible task list with stable item IDs and pending, in_progress or completed status. Preserve IDs when updating existing tasks.',
    parameters: Type.Object(
      { todos: Type.Array(TodoSchema, { maxItems: 100 }) },
      { additionalProperties: false },
    ),
  },
] satisfies readonly { name: string; description: string; parameters: TSchema }[];

/** Execute validated arguments; the common tool owner records intent and the returned result. */
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
  if (name === 'ask_user') {
    const prompt = args['prompt'];
    const options = args['options'];
    if (
      typeof prompt !== 'string' ||
      (options !== undefined &&
        (!Array.isArray(options) || !options.every((value: unknown) => typeof value === 'string')))
    )
      throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '问题字段无效。');
    return await work.ask(sessionId, runId, toolCallId, prompt, options ?? [], signal);
  }
  const state = work.snapshot(sessionId).state;
  if (name === 'update_plan') {
    const title = args['title'];
    const content = args['content'];
    if (typeof title !== 'string' || typeof content !== 'string')
      throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '计划字段无效。');
    work.save(
      sessionId,
      { ...state, plan: { title, content, status: 'draft', updatedAt: Date.now() } },
      runId,
    );
    return '计划已保存，尚未获得用户批准；这不会授予执行权限。';
  }
  if (name === 'update_todos') {
    const { Value } = await import('typebox/value');
    const todos = args['todos'];
    if (
      !Value.Check(Type.Array(TodoSchema, { maxItems: 100 }), todos) ||
      new Set(todos.map(({ id }) => id)).size !== todos.length
    )
      throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '任务清单无效或ID重复。');
    work.save(sessionId, { ...state, todos }, runId);
    return '任务清单已保存。';
  }
  throw new RuntimeError('UNKNOWN_TOOL', '该会话工具不存在。');
}
