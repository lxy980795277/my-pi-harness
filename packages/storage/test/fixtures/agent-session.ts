import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultAgentSettings,
  type AgentTask,
  type MessageView,
  type RunView,
  type ToolCallRecord,
  type ApprovalMode,
} from '@my-pi-harness/protocol';
import { openProfileStore, type EventInput, type ProfileStore } from '../../src/index.js';
import { storedToolCallId } from '../../src/sessions/projections/tool-intents.js';

export interface AgentSessionFixture {
  directory: string;
  store: ProfileStore;
}

export function event(
  type: string,
  data: Record<string, unknown>,
  runId: string | null = null,
  privateData?: Record<string, unknown>,
): EventInput {
  return { type, data, runId, at: 2, ...(privateData === undefined ? {} : { privateData }) };
}

export function run(id: string, taskId?: string): RunView {
  return {
    id,
    sessionId: 'session',
    branchId: 'main',
    providerId: 'provider',
    modelId: 'model',
    status: 'running',
    createdAt: 2,
    finishedAt: null,
    error: null,
    ...(taskId === undefined ? {} : { taskId }),
  };
}

export function user(id: string, runId: string, text: string): MessageView {
  return {
    id,
    sessionId: 'session',
    branchId: 'main',
    runId,
    role: 'user',
    text,
    thinking: '',
    createdAt: 2,
    status: 'complete',
    stopReason: null,
  };
}

export function codec(text: string): Record<string, unknown> {
  return {
    codecVersion: 1,
    sdkVersion: '1.1.0',
    message: { role: 'user', content: text, timestamp: 2 },
  };
}

export function spawn(
  store: ProfileStore,
  id: string,
  parentRunId = 'root',
  roleId = 'researcher',
): AgentTask {
  const args = { title: id, task: `Read ${id}`, roleId };
  const assistantId = `delegate-${id}`;
  const callId = `call-${id}`;
  const sourceToolCallId = storedToolCallId(parentRunId, assistantId, callId);
  const role = defaultAgentSettings().roles.find((item) => item.id === roleId);
  if (!role) throw new Error('Default researcher role is required');
  const task: AgentTask = {
    id,
    sourceToolCallId,
    title: id,
    role,
    limits: defaultAgentSettings().limits,
    createdAt: 2,
  };
  const tool: ToolCallRecord = {
    id: sourceToolCallId,
    sessionId: 'session',
    branchId: 'main',
    runId: parentRunId,
    name: 'spawn_agent',
    arguments: args,
    binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'running',
    summary: id,
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 2,
  };
  store.append('session', [
    event(
      'message.started',
      { ...user(assistantId, parentRunId, ''), role: 'assistant', stopReason: 'toolUse' },
      parentRunId,
      {
        codecVersion: 1,
        sdkVersion: '1.1.0',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: callId, name: 'spawn_agent', arguments: args }],
        },
      },
    ),
    event('tool.requested', { tool }, parentRunId),
    event('task.created', { task }, parentRunId),
    event('run.accepted', { run: run(`run-${id}`, id), requestId: `request-${id}` }, `run-${id}`),
    event(
      'message.started',
      user(`user-${id}`, `run-${id}`, `Read ${id}`),
      `run-${id}`,
      codec(`Read ${id}`),
    ),
  ]);
  return task;
}

export async function createAgentSession(
  approvalMode: ApprovalMode = 'ask',
): Promise<AgentSessionFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-agents-'));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Agents',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode,
    at: 1,
  });
  store.append('session', [
    event('run.accepted', { run: run('root'), requestId: 'root-request' }, 'root'),
    event(
      'message.started',
      user('root-user', 'root', 'Root request'),
      'root',
      codec('Root request'),
    ),
  ]);
  return value;
}
