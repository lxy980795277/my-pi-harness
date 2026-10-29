import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { MessageView, ToolCallRecord } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileStore } from '../src/index.js';
import { storedToolCallId } from '../src/sessions/projections/tool-intents.js';
import {
  createAgentSession,
  event,
  spawn,
  user,
  type AgentSessionFixture,
} from './fixtures/agent-session.js';

interface TaskToolFixture {
  message: MessageView;
  tool: ToolCallRecord;
}

const fixtures: AgentSessionFixture[] = [];

async function fixture(): Promise<AgentSessionFixture> {
  const value = await createAgentSession();
  fixtures.push(value);
  return value;
}

function taskTool(
  store: ProfileStore,
  id: string,
  runId: string,
  status: 'running' | 'reviewing' | 'awaiting_approval',
  text = id,
): TaskToolFixture {
  const call = `provider-${id}`;
  const message: MessageView = {
    ...user(`message-${id}`, runId, text),
    role: 'assistant',
    stopReason: 'toolUse',
  };
  const args = { url: `https://example.com/${id}` };
  const tool: ToolCallRecord = {
    id: storedToolCallId(runId, message.id, call),
    sessionId: 'session',
    runId,
    branchId: 'main',
    name: 'web_fetch',
    arguments: args,
    status,
    binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    summary: id,
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 2,
  };
  store.append('session', [
    event('message.started', message, runId, {
      codecVersion: 1,
      sdkVersion: '1.1.0',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: call, name: tool.name, arguments: args }],
      },
    }),
    event('tool.requested', { tool }, runId),
  ]);
  return { message, tool };
}

function reportedMessage(
  store: ProfileStore,
  id: string,
  runId: string,
  totalTokens: number,
): void {
  const message: MessageView = {
    ...user(id, runId, `${id}_BODY_`.repeat(20_000)),
    role: 'assistant',
    stopReason: 'stop',
    finishedAt: 3,
    usage: {
      inputTokens: totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens,
    },
  };
  store.append('session', [
    event('message.started', message, runId, {
      codecVersion: 1,
      sdkVersion: '1.1.0',
      message: { role: 'assistant', content: [{ type: 'text', text: message.text }] },
    }),
  ]);
}

function otherSession(store: ProfileStore): void {
  store.createSession({
    id: 'other',
    branchId: 'other-main',
    title: 'Other',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('bounded agent task queries', () => {
  it('loads only page bodies and page or pending tools, leaving sibling and off-page bodies undecoded', async () => {
    const { store, directory } = await fixture();
    spawn(store, 'first');
    spawn(store, 'sibling');
    const selected = taskTool(store, 'PAGE_TOOL', 'run-first', 'running', 'PAGE_BODY');
    taskTool(store, 'OFFPAGE_TOOL', 'run-first', 'running', 'OFFPAGE_BODY_'.repeat(20_000));
    const pending = taskTool(store, 'PENDING_TOOL', 'run-first', 'awaiting_approval');
    taskTool(store, 'SIBLING_TOOL', 'run-sibling', 'running', 'SIBLING_BODY_'.repeat(20_000));
    const parsed = vi.spyOn(JSON, 'parse');
    const prepared = vi.spyOn(Database.prototype, 'prepare');
    const detail = store.getAgentTaskDetail('session', 'first', 1, 1);
    expect(detail.messages.map((message) => message.id)).toEqual([selected.message.id]);
    expect(detail.nextCursor).toBe(2);
    expect(detail.tools.map((tool) => tool.id)).toEqual([selected.tool.id, pending.tool.id]);
    expect(detail).not.toHaveProperty('messagesQueue');
    const decoded = parsed.mock.calls.map(([text]) => text);
    expect(decoded.filter((text) => text.includes('PAGE_BODY'))).toHaveLength(1);
    expect(decoded.some((text) => text.includes('OFFPAGE_BODY_'))).toBe(false);
    expect(decoded.some((text) => text.includes('SIBLING_BODY_'))).toBe(false);
    expect(decoded.some((text) => text.includes('OFFPAGE_TOOL'))).toBe(false);
    expect(decoded.some((text) => text.includes('SIBLING_TOOL'))).toBe(false);
    const lookahead = prepared.mock.calls
      .map(([query]) => query)
      .find((query) => query.includes('"task_messages"."ordinal" > ?'));
    expect(lookahead).toContain('limit ?');
    if (lookahead === undefined) throw new Error('Missing bounded message page query');
    parsed.mockRestore();
    prepared.mockRestore();
    const observer = new Database(join(directory, 'data.sqlite'), { readonly: true });
    try {
      const plan: unknown = observer
        .prepare(`EXPLAIN QUERY PLAN ${lookahead}`)
        .all('first', 1, 'session', 2);
      expect(JSON.stringify(plan)).toContain('task_id=? AND ordinal>?');
    } finally {
      observer.close();
    }
    expect(store.getTaskSnapshot('session', 'first').messages).toHaveLength(4);
    const streaming: MessageView = {
      ...user('streaming', 'run-first', ''),
      role: 'assistant',
      status: 'streaming',
    };
    store.append('session', [event('message.started', streaming, 'run-first')]);
    store.publishMessageDelta('session', {
      runId: 'run-first',
      messageId: streaming.id,
      text: 'Live page',
    });
    expect(store.getAgentTaskDetail('session', 'first', 4, 1)).toMatchObject({
      messages: [{ id: streaming.id, text: 'Live page' }],
      liveRevision: 1,
      nextCursor: null,
    });
    expect(store.getAgentTaskDetail('session', 'first', 5, 1)).toMatchObject({
      messages: [],
      tools: [{ id: pending.tool.id }],
      nextCursor: null,
    });
  });

  it('aggregates only its task subtree usage without transferring complete message bodies', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    spawn(store, 'nested', 'run-first');
    spawn(store, 'sibling');
    reportedMessage(store, 'first-output', 'run-first', 10);
    reportedMessage(store, 'nested-output', 'run-nested', 20);
    reportedMessage(store, 'sibling-output', 'run-sibling', 900_000);
    reportedMessage(store, 'root-output', 'root', 800_000);
    const parsed = vi.spyOn(JSON, 'parse');
    expect(store.getAgentTask('session', 'first')?.usage?.totalTokens).toBe(30);
    expect(store.getAgentTask('session', 'nested')?.usage?.totalTokens).toBe(20);
    expect(store.getAgentTask('session', 'sibling')?.usage?.totalTokens).toBe(900_000);
    expect(parsed.mock.calls.some(([text]) => text.includes('_BODY_'))).toBe(false);
  });
});

describe('branch-visible tool lookup', () => {
  it('retains inherited task tools, hides a trimmed delegation and keeps child tools outside the root snapshot', async () => {
    const { store } = await fixture();
    const task = spawn(store, 'first');
    const { tool } = taskTool(store, 'child-artifact', 'run-first', 'running');
    store.append('session', [
      event('message.started', user('later-user', 'root', 'Later'), 'root'),
    ]);
    store.recoverInterrupted();
    expect(store.getVisibleTool('session', tool.id)?.id).toBe(tool.id);
    expect(store.getSnapshot('session').tools.some((item) => item.id === tool.id)).toBe(false);
    for (const [id, forkMessageId, visible] of [
      ['inherited', 'later-user', true],
      ['trimmed', 'root-user', false],
    ] as const) {
      store.append('session', [
        event('branch.created', {
          id,
          sessionId: 'session',
          parentId: 'main',
          forkMessageId,
          createdAt: 3,
        }),
        event('branch.selected', { branchId: id }),
      ]);
      expect(store.getVisibleTool('session', tool.id)?.id === tool.id).toBe(visible);
      expect(store.getVisibleTool('session', task.sourceToolCallId) !== undefined).toBe(visible);
    }
    otherSession(store);
    expect(store.getVisibleTool('other', tool.id)).toBeUndefined();
    expect(store.getVisibleTool('missing', tool.id)).toBeUndefined();
    store.append('session', [event('session.deleted', {})]);
    expect(store.getVisibleTool('session', tool.id)).toBeUndefined();
  });

  it.each(['run-session', 'task-session', 'message-run'])(
    'refuses damaged %s provenance rather than exposing another execution',
    async (damage) => {
      const { store, directory } = await fixture();
      spawn(store, 'first');
      const { tool, message } = taskTool(store, 'child-artifact', 'run-first', 'running');
      otherSession(store);
      const observer = new Database(join(directory, 'data.sqlite'));
      try {
        if (damage === 'run-session')
          observer.prepare('UPDATE runs SET session_id = ? WHERE id = ?').run('other', 'run-first');
        else if (damage === 'task-session')
          observer
            .prepare('UPDATE agent_tasks SET session_id = ? WHERE id = ?')
            .run('other', 'first');
        else
          observer
            .prepare("UPDATE messages SET data = json_set(data, '$.runId', 'root') WHERE id = ?")
            .run(message.id);
        expect(() => store.getVisibleTool('session', tool.id)).toThrow('provenance');
      } finally {
        observer.close();
      }
    },
  );
});
