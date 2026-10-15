import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessageView, ToolCallRecord } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type EventInput, type ProfileStore } from '../src/index.js';

const owned: { directory: string; store: ProfileStore }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    item.store.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});

function event(type: string, data: Record<string, unknown>, privateData?: string): EventInput {
  return { type, runId: 'run', at: 2, data, ...(privateData === undefined ? {} : { privateData }) };
}

function message(
  id: string,
  role: MessageView['role'],
  stopReason: string | null = null,
): MessageView {
  return {
    id,
    sessionId: 'session',
    branchId: 'main',
    runId: 'run',
    role,
    text: id,
    thinking: '',
    createdAt: 2,
    status: 'complete',
    stopReason,
  };
}

function tool(status: ToolCallRecord['status'] = 'running'): ToolCallRecord {
  return {
    id: 'call',
    sessionId: 'session',
    branchId: 'main',
    runId: 'run',
    name: 'read_file',
    arguments: { path: 'file.txt' },
    status,
    summary: 'Read file.txt',
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 2,
  };
}

async function fixture(
  stopReason = 'toolUse',
): Promise<{ directory: string; store: ProfileStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-tool-storage-'));
  const store = await openProfileStore(directory);
  owned.push({ directory, store });
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Tools',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  store.append('session', [
    event('run.accepted', {
      requestId: 'request',
      run: {
        id: 'run',
        sessionId: 'session',
        branchId: 'main',
        providerId: 'provider',
        modelId: 'model',
        status: 'running',
        createdAt: 2,
        finishedAt: null,
        error: null,
      },
    }),
  ]);
  for (const input of [
    message('user', 'user'),
    message('assistant-tool', 'assistant', stopReason),
  ]) {
    store.append('session', [
      event('message.started', { ...input, status: 'streaming' }),
      event('message.completed', { message: input }, `codec-${input.id}`),
    ]);
  }
  return { directory, store };
}

describe('durable tool projections', () => {
  it('preserves request order for tied timestamps across updates, assistant anchors, branches and reopen', async () => {
    const { directory, store } = await fixture();
    const first = { ...tool(), id: 'z-first' };
    const second = { ...tool(), id: 'm-second' };
    store.append('session', [
      event('tool.requested', { tool: first }),
      event('tool.requested', { tool: second }),
      event('tool.updated', { tool: { ...second, status: 'completed', updatedAt: 4 } }),
      event('tool.updated', { tool: { ...first, status: 'completed', updatedAt: 5 } }),
    ]);
    expect(store.getSnapshot('session').tools.map((entry) => entry.id)).toEqual([
      'z-first',
      'm-second',
    ]);

    const assistant = message('second-assistant', 'assistant', 'toolUse');
    const later = { ...tool(), id: 'a-later' };
    store.append('session', [
      event('message.started', { ...assistant, status: 'streaming' }),
      event('message.completed', { message: assistant }, 'codec-second-assistant'),
      event('tool.requested', { tool: later }),
      event('tool.updated', { tool: { ...later, status: 'completed' } }),
    ]);
    const nextUser = message('next-user', 'user');
    store.append('session', [
      event('message.started', { ...nextUser, status: 'streaming' }),
      event('message.completed', { message: nextUser }, 'codec-next-user'),
      event('run.finished', { status: 'completed', finishedAt: 6, error: null }),
      {
        type: 'branch.created',
        runId: null,
        at: 7,
        data: {
          id: 'prefix',
          sessionId: 'session',
          parentId: 'main',
          forkMessageId: 'next-user',
          createdAt: 7,
        },
      },
      { type: 'branch.selected', runId: null, at: 7, data: { branchId: 'prefix' } },
    ]);
    const expected = ['z-first', 'm-second', 'a-later'];
    expect(store.getSnapshot('session').tools.map((entry) => entry.id)).toEqual(expected);
    expect(store.getSnapshot('session').tools.map((entry) => entry.afterMessageId)).toEqual([
      'assistant-tool',
      'assistant-tool',
      'second-assistant',
    ]);
    store.close();
    const reopened = await openProfileStore(directory);
    owned.push({ directory, store: reopened });
    expect(reopened.getSnapshot('session').tools.map((entry) => entry.id)).toEqual(expected);
    expect(reopened.getSnapshot('session').tools.map((entry) => entry.afterMessageId)).toEqual([
      'assistant-tool',
      'assistant-tool',
      'second-assistant',
    ]);
    for (const entry of reopened
      .readEvents('session')
      .filter((item) => item.type === 'tool.requested' || item.type === 'tool.updated'))
      expect(entry.data['tool']).not.toHaveProperty('afterMessageId');
    reopened.append('session', [
      { type: 'branch.selected', runId: null, at: 8, data: { branchId: 'main' } },
    ]);
    expect(reopened.getSnapshot('session').tools.map((entry) => entry.id)).toEqual(expected);
  });

  it('accepts an SDK rejection result anchored to a token-limited assistant', async () => {
    const { store } = await fixture('length');
    store.append('session', [
      event('tool.requested', {
        tool: { ...tool('failed'), result: 'Arguments were truncated; not executed' },
      }),
      event(
        'tool.context',
        { branchId: 'main', afterMessageId: 'assistant-tool', toolCallId: 'call' },
        'codec-truncation-error',
      ),
    ]);
    expect(store.getSnapshot('session').tools[0]?.status).toBe('failed');
    expect(store.getModelContext('session', 'main')).toEqual([
      'codec-user',
      'codec-assistant-tool',
      'codec-truncation-error',
    ]);
  });

  it('keeps results private, orders context after its assistant and follows selected branch prefixes', async () => {
    const { store } = await fixture();
    store.append('session', [
      event('tool.requested', { tool: tool() }),
      event('tool.updated', { tool: { ...tool('completed'), result: 'Read result' } }),
      event(
        'tool.context',
        { branchId: 'main', afterMessageId: 'assistant-tool', toolCallId: 'call' },
        'codec-tool-result',
      ),
    ]);
    const final = message('assistant-final', 'assistant', 'stop');
    const nextUser = message('next-user', 'user');
    for (const input of [final, nextUser]) {
      store.append('session', [
        event('message.started', { ...input, status: 'streaming' }),
        event('message.completed', { message: input }, `codec-${input.id}`),
      ]);
    }
    store.append('session', [
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }),
    ]);
    expect(store.getModelContext('session', 'main')).toEqual([
      'codec-user',
      'codec-assistant-tool',
      'codec-tool-result',
      'codec-assistant-final',
      'codec-next-user',
    ]);
    expect(store.readEvents('session').find((item) => item.type === 'tool.context')?.data).toEqual({
      branchId: 'main',
      afterMessageId: 'assistant-tool',
      toolCallId: 'call',
    });
    expect(JSON.stringify(store.getSnapshot('session'))).not.toContain('codec-tool-result');
    store.append('session', [
      {
        type: 'branch.created',
        runId: null,
        at: 4,
        data: {
          id: 'prefix',
          sessionId: 'session',
          parentId: 'main',
          forkMessageId: 'next-user',
          createdAt: 4,
        },
      },
      { type: 'branch.selected', runId: null, at: 4, data: { branchId: 'prefix' } },
    ]);
    expect(store.getSnapshot('session').tools).toEqual([
      { ...tool('completed'), result: 'Read result', afterMessageId: 'assistant-tool' },
    ]);
    expect(store.getModelContext('session', 'prefix', ['user', 'assistant-tool'])).toEqual([
      'codec-user',
      'codec-assistant-tool',
      'codec-tool-result',
    ]);
    expect(() => store.getModelContext('session', 'prefix', ['next-user'])).toThrow(
      'selected branch',
    );
    store.append('session', [
      {
        type: 'branch.created',
        runId: null,
        at: 5,
        data: {
          id: 'empty',
          sessionId: 'session',
          parentId: 'main',
          forkMessageId: 'user',
          createdAt: 5,
        },
      },
      { type: 'branch.selected', runId: null, at: 5, data: { branchId: 'empty' } },
    ]);
    expect(store.getSnapshot('session').tools).toEqual([]);
    expect(store.getModelContext('session', 'empty')).toEqual([]);
  });

  it('rejects wrong identities, anchors and rewrites without committing a partial event batch', async () => {
    const { store } = await fixture();
    const before = store.getSnapshot('session').snapshotSeq;
    expect(() =>
      store.append('session', [
        event('tool.requested', { tool: { ...tool(), branchId: 'other' } }),
      ]),
    ).toThrow('identity');
    expect(store.getSnapshot('session').snapshotSeq).toBe(before);
    store.append('session', [event('tool.requested', { tool: tool() })]);
    expect(() =>
      store.append('session', [
        event(
          'tool.context',
          { branchId: 'main', afterMessageId: 'user', toolCallId: 'call' },
          'private',
        ),
      ]),
    ).toThrow('anchor');
    expect(() =>
      store.append('session', [
        event('tool.updated', { tool: { ...tool('completed'), arguments: { path: 'other.txt' } } }),
      ]),
    ).toThrow('accepted request');
    store.append('session', [event('tool.updated', { tool: tool('completed') })]);
    expect(() =>
      store.append('session', [event('tool.updated', { tool: tool('failed') })]),
    ).toThrow('cannot be rewritten');
  });

  it('recovers pending approvals and active tools as interrupted in the same durable run recovery', async () => {
    const { directory, store } = await fixture();
    store.append('session', [
      event('tool.requested', { tool: { ...tool('running'), id: 'z-running' } }),
      event('tool.requested', { tool: { ...tool('awaiting_approval'), id: 'a-awaiting' } }),
      event('tool.requested', { tool: { ...tool('reviewing'), id: 'reviewing' } }),
    ]);
    store.close();
    const reopened = await openProfileStore(directory);
    owned.push({ directory, store: reopened });
    expect(
      reopened.getSnapshot('session').tools.map((entry) => ({
        id: entry.id,
        status: entry.status,
      })),
    ).toEqual([
      { id: 'z-running', status: 'interrupted' },
      { id: 'a-awaiting', status: 'interrupted' },
      { id: 'reviewing', status: 'interrupted' },
    ]);
    expect(reopened.getSnapshot('session').runs[0]?.status).toBe('interrupted');
    const tail = reopened.readEvents('session').slice(-4);
    expect(tail.map((item) => item.type)).toEqual([
      'tool.updated',
      'tool.updated',
      'tool.updated',
      'run.finished',
    ]);
    expect(tail[1]?.seq).toBe((tail[0]?.seq ?? 0) + 1);
    expect(tail[2]?.seq).toBe((tail[1]?.seq ?? 0) + 1);
    expect(tail[3]?.seq).toBe((tail[2]?.seq ?? 0) + 1);
    for (const updated of tail.slice(0, 3))
      expect(updated.data['tool']).not.toHaveProperty('afterMessageId');
  });
});
