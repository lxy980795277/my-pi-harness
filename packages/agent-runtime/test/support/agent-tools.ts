import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { AgentTaskSummarySchema } from '@my-pi-harness/protocol';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { call } from './work-fixture.js';

type SpawnReceipt = Static<typeof SpawnReceiptSchema>;

const SpawnReceiptSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: AgentTaskSummarySchema.properties.status,
    runId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export function taskResults(context: TranscriptContext): SpawnReceipt[] {
  return context.messages.flatMap((message) => {
    if (message.role !== 'toolResult' || message.toolName !== 'spawn_agent' || message.isError)
      return [];
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    const parsed: unknown = JSON.parse(text);
    if (!Value.Check(SpawnReceiptSchema, parsed)) throw new Error(`Delegation failed: ${text}`);
    return [parsed];
  });
}

export function resultCount(context: TranscriptContext, name: string): number {
  return context.messages.filter(
    (message) => message.role === 'toolResult' && message.toolName === name,
  ).length;
}

export function hasResult(context: TranscriptContext, name: string): boolean {
  return resultCount(context, name) > 0;
}

export function delegate(
  title: string,
  task: string,
  id = 'spawn',
  roleId = 'researcher',
): AssistantMessage {
  return call('spawn_agent', { title, task, roleId }, id);
}

export function waitForResults(context: TranscriptContext, id = 'wait'): AssistantMessage {
  const tasks = taskResults(context);
  if (tasks.length === 0) throw new Error('Missing accepted delegation');
  return call('wait_agents', { taskIds: tasks.map((task) => task.id), timeoutMs: 5000 }, id);
}
