import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StoredToolResultSchema,
  type MessageView,
  type ToolCallRecord,
  type StoredToolResult,
} from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type EventInput, type ProfileStore } from '../src/index.js';
import { storedToolCallId } from '../src/sessions/projections/tool-intents.js';
import { checked } from '../src/shared/validation.js';

const owned: { directory: string; store: ProfileStore }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    item.store.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});
function event(
  type: string,
  data: Record<string, unknown>,
  privateData?: Record<string, unknown>,
): EventInput {
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
function tool(
  providerCallId = 'call',
  status: ToolCallRecord['status'] = 'running',
  anchor = 'assistant-tool',
): ToolCallRecord {
  return {
    id: storedToolCallId('run', anchor, providerCallId),
    sessionId: 'session',
    branchId: 'main',
    runId: 'run',
    name: 'read_file',
    arguments: { path: 'file.txt' },
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status,
    summary: 'Read file.txt',
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 2,
  };
}
function external(providerCallId = 'call'): ToolCallRecord {
  return {
    ...tool(providerCallId),
    binding: {
      kind: 'accepted',
      source: { kind: 'mcp', serverId: 'server', serverRevision: 1, remoteToolName: 'remote-read' },
      fingerprint: 'b'.repeat(64),
    },
    dispatch: { state: 'not_started' },
  };
}
function result(
  record: ToolCallRecord,
  providerCallId = 'call',
  anchor = 'assistant-tool',
  origin: StoredToolResult['origin'] = 'tool',
): EventInput {
  if (
    record.status === 'running' ||
    record.status === 'reviewing' ||
    record.status === 'awaiting_approval'
  )
    throw new Error('Test result requires terminal state');
  const value: StoredToolResult = {
    toolResultVersion: 1,
    providerCallId,
    toolName: record.name,
    content: [{ type: 'text', text: 'private-result' }],
    isError: record.status !== 'completed',
    at: record.updatedAt,
    origin,
    outcome: record.status,
  };
  return event(
    'tool.context',
    { branchId: 'main', afterMessageId: anchor, toolCallId: record.id },
    value,
  );
}
function terminal(
  record: ToolCallRecord,
  providerCallId = 'call',
  anchor = 'assistant-tool',
  origin: StoredToolResult['origin'] = 'tool',
): EventInput[] {
  return [event('tool.updated', { tool: record }), result(record, providerCallId, anchor, origin)];
}
function codec(ids: readonly string[]): Record<string, unknown> {
  return {
    codecVersion: 1,
    sdkVersion: '1.1.0',
    message: {
      role: 'assistant',
      content: ids.map((id) => ({
        type: 'toolCall',
        id,
        name: 'read_file',
        arguments: { path: 'file.txt' },
      })),
    },
  };
}
async function fixture(ids: readonly string[] = ['call'], stopReason = 'toolUse') {
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
  const user = message('user', 'user');
  const assistant = message('assistant-tool', 'assistant', stopReason);
  for (const value of [user, assistant])
    store.append('session', [
      event('message.started', { ...value, status: 'streaming' }),
      event(
        'message.completed',
        { message: value },
        value.role === 'assistant' ? codec(ids) : { marker: 'codec-user' },
      ),
    ]);
  return { directory, store };
}
async function reopen(value: Awaited<ReturnType<typeof fixture>>) {
  value.store.close();
  const store = await openProfileStore(value.directory);
  owned.push({ directory: value.directory, store });
  return store;
}

describe('durable tool outcomes and private result atomicity', () => {
  it('preserves tied request order and assistant anchors through branches and reopening', async () => {
    const value = await fixture(['first', 'second']);
    const first = tool('first');
    const second = tool('second');
    value.store.append('session', [
      event('tool.requested', { tool: first }),
      event('tool.requested', { tool: second }),
      ...terminal({ ...second, status: 'completed', updatedAt: 4 }, 'second'),
      ...terminal({ ...first, status: 'completed', updatedAt: 5 }, 'first'),
    ]);
    const next = message('next-user', 'user');
    value.store.append('session', [
      event('message.started', { ...next, status: 'streaming' }),
      event('message.completed', { message: next }, { marker: 'codec-next-user' }),
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
    expect(value.store.getSnapshot('session').tools.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
    const store = await reopen(value);
    expect(
      store.getSnapshot('session').tools.map(({ id, afterMessageId }) => ({ id, afterMessageId })),
    ).toEqual([
      { id: first.id, afterMessageId: 'assistant-tool' },
      { id: second.id, afterMessageId: 'assistant-tool' },
    ]);
    expect(store.getModelContext('session', 'prefix')).toHaveLength(4);
    expect(JSON.stringify(store.getSnapshot('session'))).not.toContain('private-result');
  });

  it('accepts a rejected truncated model call with its host result in the same batch', async () => {
    const { store } = await fixture(['call'], 'length');
    const record = {
      ...tool('call', 'failed'),
      binding: { kind: 'rejected' as const, reason: 'Arguments truncated' },
    };
    store.append('session', [
      event('tool.requested', { tool: record }),
      result(record, 'call', 'assistant-tool', 'host'),
    ]);
    expect(store.getSnapshot('session').tools[0]?.status).toBe('failed');
    expect(store.getModelContext('session', 'main')).toEqual([
      { marker: 'codec-user' },
      codec(['call']),
      expect.objectContaining({ content: [{ type: 'text', text: 'private-result' }] }),
    ]);
  });

  it('rejects terminal/context split transactions and inconsistent result fields without advancing the journal', async () => {
    const { store } = await fixture();
    const requested = tool();
    store.append('session', [event('tool.requested', { tool: requested })]);
    const before = store.getSnapshot('session').snapshotSeq;
    const completed = tool('call', 'completed');
    expect(() => store.append('session', [event('tool.updated', { tool: completed })])).toThrow(
      'committed together',
    );
    expect(() => store.append('session', [result(completed)])).toThrow('terminal');
    expect(() =>
      store.append('session', [
        event('tool.updated', { tool: completed }),
        result({ ...completed, status: 'failed' }),
      ]),
    ).toThrow('does not match');
    expect(store.getSnapshot('session').snapshotSeq).toBe(before);
    store.append('session', terminal(completed));
    expect(() => store.append('session', terminal(tool('call', 'failed')))).toThrow(
      'cannot be rewritten',
    );
  });

  it('rejects changed identities, accepted bindings, parameters, anchors and duplicate contexts', async () => {
    const { store } = await fixture();
    expect(() =>
      store.append('session', [
        event('tool.requested', { tool: { ...tool(), branchId: 'other' } }),
      ]),
    ).toThrow('identity');
    expect(() =>
      store.append('session', [
        event('tool.requested', { tool: { ...tool(), arguments: { path: 'other' } } }),
      ]),
    ).toThrow('persisted assistant intent');
    store.append('session', [event('tool.requested', { tool: tool() })]);
    expect(() =>
      store.append('session', [
        event('tool.updated', {
          tool: { ...tool(), binding: { kind: 'rejected', reason: 'changed' } },
        }),
      ]),
    ).toThrow();
    const done = tool('call', 'completed');
    expect(() =>
      store.append('session', [
        event('tool.updated', { tool: done }),
        result(done, 'call', 'user'),
      ]),
    ).toThrow('anchor');
    expect(() =>
      store.append('session', [event('tool.updated', { tool: done }), result(done), result(done)]),
    ).toThrow();
    expect(store.getSnapshot('session').tools[0]?.status).toBe('running');
  });

  it('requires a monotonic dispatch barrier for external completion or unknown results', async () => {
    const { store } = await fixture();
    const start = external();
    store.append('session', [event('tool.requested', { tool: start })]);
    expect(() =>
      store.append(
        'session',
        terminal({ ...start, status: 'unknown' }, 'call', 'assistant-tool', 'host'),
      ),
    ).toThrow('dispatch barrier');
    expect(() =>
      store.append(
        'session',
        terminal({ ...start, status: 'completed' }, 'call', 'assistant-tool', 'server'),
      ),
    ).toThrow('dispatch barrier');
    const dispatched: ToolCallRecord = {
      ...start,
      dispatch: { state: 'may_have_started', attemptId: 'attempt', at: 3 },
      updatedAt: 3,
    };
    store.append('session', [event('tool.updated', { tool: dispatched })]);
    expect(() => store.append('session', [event('tool.updated', { tool: start })])).toThrow(
      'cannot be removed',
    );
    expect(() =>
      store.append('session', [
        event('tool.updated', {
          tool: {
            ...dispatched,
            dispatch: { state: 'may_have_started', attemptId: 'different', at: 3 },
          },
        }),
      ]),
    ).toThrow('cannot be removed');
    const unknown: ToolCallRecord = {
      ...dispatched,
      status: 'unknown',
      result: 'May have taken effect',
    };
    store.append('session', terminal(unknown, 'call', 'assistant-tool', 'host'));
    expect(() =>
      store.append(
        'session',
        terminal({ ...unknown, status: 'completed' }, 'call', 'assistant-tool', 'server'),
      ),
    ).toThrow('cannot be rewritten');
  });

  it('distinguishes known server errors from undispatched host errors', async () => {
    const { store } = await fixture(['call', 'other']);
    const start = external();
    store.append('session', [event('tool.requested', { tool: start })]);
    expect(() =>
      store.append(
        'session',
        terminal({ ...start, status: 'failed' }, 'call', 'assistant-tool', 'server'),
      ),
    ).toThrow('Server results');
    store.append(
      'session',
      terminal({ ...start, status: 'failed' }, 'call', 'assistant-tool', 'host'),
    );
    const other = external('other');
    store.append('session', [event('tool.requested', { tool: other })]);
    const dispatched: ToolCallRecord = {
      ...other,
      dispatch: { state: 'may_have_started', attemptId: 'attempt', at: 3 },
    };
    store.append('session', [event('tool.updated', { tool: dispatched })]);
    store.append(
      'session',
      terminal({ ...dispatched, status: 'failed' }, 'other', 'assistant-tool', 'server'),
    );
    expect(store.getSnapshot('session').tools.map(({ status }) => status)).toEqual([
      'failed',
      'failed',
    ]);
  });

  it('recovers may-have-started as unknown, undispatched as interrupted and never-entered calls exactly once', async () => {
    const value = await fixture(['dispatched', 'waiting', 'never-entered']);
    const dispatched: ToolCallRecord = {
      ...external('dispatched'),
      dispatch: { state: 'may_have_started', attemptId: 'attempt', at: 3 },
    };
    value.store.append('session', [
      event('tool.requested', { tool: external('dispatched') }),
      event('tool.updated', { tool: dispatched }),
      event('tool.requested', { tool: { ...external('waiting'), status: 'awaiting_approval' } }),
    ]);
    const store = await reopen(value);
    const snapshot = store.getSnapshot('session');
    expect(snapshot.tools.map(({ status }) => status)).toEqual([
      'unknown',
      'interrupted',
      'interrupted',
    ]);
    expect(snapshot.tools[2]?.binding.kind).toBe('rejected');
    expect(snapshot.runs[0]?.status).toBe('failed');
    const contexts = store
      .getModelContext('session', 'main')
      .slice(2)
      .map((value) => checked(StoredToolResultSchema, value));
    expect(contexts.map(({ providerCallId, outcome }) => ({ providerCallId, outcome }))).toEqual([
      { providerCallId: 'dispatched', outcome: 'unknown' },
      { providerCallId: 'waiting', outcome: 'interrupted' },
      { providerCallId: 'never-entered', outcome: 'interrupted' },
    ]);
    const note = contexts[0]?.content[0];
    expect(note?.type).toBe('text');
    if (note?.type !== 'text') throw new Error('Recovery note missing');
    expect(note.text).toContain('may have taken effect');
    const before = snapshot.snapshotSeq;
    expect(store.recoverInterrupted()).toEqual([]);
    expect(store.getSnapshot('session').snapshotSeq).toBe(before);
  });

  it('preserves completed results on restart and recovers only remaining assistant calls', async () => {
    const value = await fixture(['done', 'not-started']);
    value.store.append('session', [
      event('tool.requested', { tool: tool('done') }),
      ...terminal(tool('done', 'completed'), 'done'),
    ]);
    const store = await reopen(value);
    expect(store.getSnapshot('session').tools.map(({ status }) => status)).toEqual([
      'completed',
      'interrupted',
    ]);
    expect(store.getModelContext('session', 'main')).toHaveLength(4);
    expect(store.readEvents('session').filter(({ type }) => type === 'tool.context')).toHaveLength(
      2,
    );
  });

  it('recovers a proven not-written barrier as interrupted rather than unknown', async () => {
    const value = await fixture();
    const start = external();
    value.store.append('session', [
      event('tool.requested', { tool: start }),
      event('tool.updated', {
        tool: {
          ...start,
          dispatch: {
            state: 'may_have_started',
            attemptId: 'attempt',
            at: 3,
            confirmedNotWritten: true,
          },
        },
      }),
    ]);
    const store = await reopen(value);
    expect(store.getSnapshot('session').tools[0]?.status).toBe('interrupted');
    expect(store.getSnapshot('session').runs[0]?.status).toBe('interrupted');
  });

  it('pairs missing intents in an already terminal Run without rewriting that Run or replaying tools', async () => {
    const value = await fixture(['never-entered']);
    value.store.append('session', [
      event('run.finished', { status: 'cancelled', finishedAt: 3, error: null }),
    ]);
    const store = await reopen(value);
    expect(store.getSnapshot('session').runs[0]?.status).toBe('cancelled');
    expect(store.getSnapshot('session').tools[0]?.status).toBe('interrupted');
    expect(store.getModelContext('session', 'main')).toHaveLength(3);
    expect(store.recoverInterrupted()).toEqual([]);
  });

  it('keeps rejected long names and malformed arguments in private intent while validating bounded public fields', async () => {
    const { store } = await fixture([]);
    const anchor = message('malformed-assistant', 'assistant', 'toolUse');
    const rawName = 'unknown_tool_'.repeat(20);
    const rawCodec = {
      codecVersion: 1,
      sdkVersion: '1.1.0',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'malformed', name: rawName, arguments: 'invalid-json-object' },
        ],
      },
    };
    store.append('session', [
      event('message.started', { ...anchor, status: 'streaming' }),
      event('message.completed', { message: anchor }, rawCodec),
    ]);
    const rejected = {
      ...tool('malformed', 'failed', anchor.id),
      name: rawName.slice(0, 100),
      arguments: {},
      binding: { kind: 'rejected' as const, reason: 'Model call was rejected' },
    };
    const context = result(rejected, 'malformed', anchor.id, 'host');
    const privateResult: StoredToolResult = {
      toolResultVersion: 1,
      providerCallId: 'malformed',
      toolName: rawName,
      content: [{ type: 'text', text: 'Not executed' }],
      isError: true,
      at: 2,
      origin: 'host',
      outcome: 'failed',
    };
    store.append('session', [
      event('tool.requested', { tool: rejected }),
      { ...context, privateData: privateResult },
    ]);
    expect(store.getSnapshot('session').tools[0]?.name).toHaveLength(100);
    expect(store.getModelContext('session', 'main').at(-1)).toMatchObject({ toolName: rawName });
  });

  it('persists a rejected oversized object as a bounded public argument preview', async () => {
    const { store } = await fixture([]);
    const anchor = message('oversized-assistant', 'assistant', 'toolUse');
    const rawArguments = { path: 'x'.repeat(256_000) };
    const rawCodec = {
      codecVersion: 1,
      sdkVersion: '1.1.0',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'oversized', name: 'read_file', arguments: rawArguments },
        ],
      },
    };
    store.append('session', [
      event('message.started', { ...anchor, status: 'streaming' }),
      event('message.completed', { message: anchor }, rawCodec),
    ]);
    const rejected = {
      ...tool('oversized', 'failed', anchor.id),
      arguments: {},
      binding: { kind: 'rejected' as const, reason: 'Arguments exceed the configured limit' },
    };
    store.append('session', [
      event('tool.requested', { tool: rejected }),
      result(rejected, 'oversized', anchor.id, 'host'),
    ]);
    expect(store.getSnapshot('session').tools[0]?.arguments).toEqual({});
    expect(store.getSnapshot('session').tools[0]?.status).toBe('failed');
    expect(store.getModelContext('session', 'main').at(-1)).toMatchObject({
      providerCallId: 'oversized',
    });
  });
});
