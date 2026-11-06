import { Type, type Static } from 'typebox';
import { TodoSchema } from '@my-pi-harness/protocol';
import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireWorkHandlers } from '../lib/tool-context.js';

export type UpdateTodosHandler = (todos: Static<typeof UpdateTodosParameters>['todos']) => string;

const UpdateTodosParameters = strictObjectSchema({
  todos: Type.Array(TodoSchema, { maxItems: 100 }),
});

export const updateTodosTool = completeToolRegistration({
  name: 'update_todos',
  description:
    'Replace visible tasks using stable IDs and optional plan-step links. Completed tasks require successful tool evidence from this Run, or an explicit completionNote for a textual conclusion. Never mark an unobserved action complete.',
  parameters: UpdateTodosParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.work,
  execute: (ports, args) => textResult(requireWorkHandlers(ports).updateTodos(args.todos)),
});
