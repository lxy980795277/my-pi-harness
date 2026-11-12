import type { ModelRequest, TestModelReply, TestModelOptions } from './model-server';

export interface MemoryToolStep {
  name: 'save_memory' | 'learn_memory' | 'update_memory' | 'delete_memory';
  arguments: Record<string, unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestedTools(request: ModelRequest): { text: string; calls: string[] } {
  const raw = request.body['messages'];
  const messages: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) for (const value of raw) if (record(value)) messages.push(value);
  let latest = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.['role'] !== 'user') continue;
    latest = index;
    break;
  }
  const text = messages[latest]?.['content'];
  const calls: string[] = [];
  for (const message of messages.slice(latest + 1)) {
    const values = message['tool_calls'];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!record(value) || !record(value['function'])) continue;
      const name = value['function']['name'];
      if (typeof name === 'string') calls.push(name);
    }
  }
  return { text: typeof text === 'string' ? text : '', calls };
}

/** Script one normal Pi tool loop per human input; tool results remain the source of success. */
export function memoryMutationReply(
  plan: (text: string) => readonly MemoryToolStep[],
): NonNullable<TestModelOptions['reply']> {
  return (request): TestModelReply => {
    const { text, calls } = requestedTools(request);
    const step = plan(text)[calls.length];
    if (step) return { kind: 'tool', name: step.name, arguments: step.arguments };
    return { kind: 'text', text: '本次操作已结束，保存结果以工具执行记录为准。' };
  };
}
