import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventInput } from '@my-pi-harness/protocol/internal';
import { openProfileStore, sessionLogDirectory, type ProfileStore } from '../src/index';

interface Fixture {
  directory: string;
  store: ProfileStore;
}
const fixtures: Fixture[] = [];
const contextUsage = {
  estimatedTokens: 10,
  windowTokens: 100,
  reservedOutput: 20,
  inputBudget: 80,
  trimmedMessages: 0,
  prunedMessages: 0,
  source: 'estimated',
  providerInputTokens: null,
  categories: {
    system: 0,
    rules: 0,
    tools: 0,
    messages: 10,
    attachments: 0,
    summary: 0,
    workingState: 0,
    memory: 0,
  },
};
const usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 50,
  cacheWriteTokens: 0,
  totalTokens: 170,
};

function event(
  type: string,
  data: Record<string, unknown>,
  privateData?: Record<string, unknown>,
  runId: string | null = 'run',
): EventInput {
  return { type, data, runId, at: 10, ...(privateData === undefined ? {} : { privateData }) };
}

async function fixture(): Promise<Fixture> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-trace-')));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  fixtures.push(value);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Trace',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  store.append('session', [
    event('run.accepted', {
      requestId: 'input',
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
    event('message.started', {
      id: 'user',
      sessionId: 'session',
      branchId: 'main',
      runId: 'run',
      role: 'user',
      text: 'Question',
      thinking: '',
      createdAt: 2,
      status: 'complete',
      stopReason: null,
    }),
  ]);
  return value;
}

function prepared(id: string, text = 'Question', image = false): EventInput {
  return event(
    'context.prepared',
    { modelRequestId: id, branchId: 'main', usage: contextUsage, messageIds: ['user'] },
    {
      version: 1,
      systemPrompt: 'private-system',
      messages: [
        {
          codecVersion: 1,
          sdkVersion: '1.4.0',
          message: {
            role: 'system',
            content: 'private-system',
            timestamp: 1,
            toolsAdded: [
              { name: 'read_file', description: 'Read', parameters: { type: 'object' } },
            ],
          },
        },
        {
          codecVersion: 1,
          sdkVersion: '1.4.0',
          message: {
            role: 'user',
            timestamp: 1,
            content: image
              ? [
                  { type: 'text', text },
                  { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
                ]
              : text,
          },
        },
      ],
    },
  );
}

function started(id: string, startedAt = 20): EventInput {
  return event('model.request.started', {
    modelRequestId: id,
    branchId: 'main',
    purpose: 'conversation',
    inputMessageId: 'user',
    providerId: 'provider',
    modelId: 'model',
    queuedAt: startedAt - 5,
    startedAt,
  });
}
function completed(id: string, startedAt = 20): EventInput {
  return event('model.request.completed', {
    modelRequestId: id,
    status: 'completed',
    finishedAt: startedAt + 10,
    durationMs: 10,
    firstResponseMs: 2,
    usage,
    error: null,
    responseId: 'provider-response',
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { directory, store } of fixtures.splice(0)) {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

describe('durable execution trace', () => {
  it('freezes invocation membership and status at the committed watermark', async () => {
    const { store } = await fixture();
    store.append('session', [prepared('first'), started('first')]);
    const frozen = store.listTrace('session');
    expect(frozen.items).toMatchObject([{ id: 'first', status: 'running', seq: 5 }]);
    store.append('session', [
      completed('first'),
      prepared('second'),
      started('second', 40),
      completed('second', 40),
    ]);
    expect(
      store.listTrace('session', { watermark: frozen.watermark, status: 'running' }).items,
    ).toHaveLength(1);
    expect(
      store.listTrace('session', { watermark: frozen.watermark, status: 'completed' }).items,
    ).toEqual([]);
    const first = store.listTrace('session', { limit: 1 });
    expect(first.items).toMatchObject([{ id: 'first', status: 'completed' }]);
    expect(
      store.listTrace('session', { cursor: first.nextCursor ?? 0, watermark: first.watermark })
        .items,
    ).toMatchObject([{ id: 'second' }]);
    expect(() => store.listTrace('session', { watermark: frozen.watermark, cursor: 1000 })).toThrow(
      'watermark',
    );
  });

  it('resolves deduplicated final input directly after restart and keeps audit bodies out of SQLite', async () => {
    const value = await fixture();
    value.store.append('session', [prepared('first'), started('first'), completed('first')]);
    value.store.append('session', [
      prepared('second'),
      started('second', 40),
      completed('second', 40),
    ]);
    const disk = await readFile(
      join(
        sessionLogDirectory(value.directory, join(value.directory, '.my-pi-harness')),
        'session.jsonl',
      ),
      'utf8',
    );
    expect(disk).toContain('"messages":[0,1]');
    const spy = vi.spyOn(value.store, 'getModelContext');
    expect(
      value.store.getModelRequest('session', 'second', { section: 'system' }).items[0]?.text,
    ).toBe('private-system');
    expect(value.store.getModelRequest('session', 'second').items[1]?.text).toBe('Question');
    expect(
      value.store.getModelRequest('session', 'second', { section: 'tools' }).items[0]?.text,
    ).toContain('read_file');
    expect(spy).not.toHaveBeenCalled();
    const db = new Database(join(value.directory, 'data.sqlite'), { readonly: true });
    try {
      expect(
        db.prepare("SELECT private_data FROM events WHERE type='context.prepared'").all(),
      ).toEqual([{ private_data: null }, { private_data: null }]);
    } finally {
      db.close();
    }
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getModelRequest('session', 'second').items[1]?.text).toBe('Question');
    expect(value.store.getSessionUsage('session')).toMatchObject({
      requestCount: 2,
      recordedRequests: 2,
      tokens: { totalTokens: 340 },
      modelDurationMs: 20,
      wallDurationMs: null,
    });
  });

  it('pages escaped Unicode content without dropping a suffix or exposing image base64', async () => {
    const { store } = await fixture();
    const text = '中文😀\n"\\'.repeat(20_000);
    store.append('session', [prepared('long', text, true), started('long'), completed('long')]);
    let cursor = 1;
    let offset = 0;
    let output = '';
    let pages = 0;
    while (true) {
      const result = store.getModelRequest('session', 'long', { cursor, offset, limit: 1 });
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(64 * 1024);
      expect(JSON.stringify(result)).not.toContain('iVBORw0KGgo=');
      output += result.items[0]?.text ?? '';
      pages += 1;
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
      offset = result.nextOffset ?? 0;
    }
    expect(output).toBe(`${text}\n[image]`);
    expect(pages).toBeGreaterThan(2);
    expect(store.getModelRequestImage('session', 'long', 1, 0)).toEqual({
      mimeType: 'image/png',
      bytes: Buffer.from('iVBORw0KGgo=', 'base64'),
    });
    expect(() => store.getModelRequestImage('session', 'long', 1, 1)).toThrow('unavailable');
  });

  it('indexes manual auxiliary snapshots and preserves unknown response usage', async () => {
    const { store } = await fixture();
    store.append('session', [
      event(
        'context.compaction.prepared',
        { branchId: 'main', modelRequestId: 'summary' },
        {
          version: 1,
          purpose: 'compaction',
          systemPrompt: 'Summary instructions',
          messages: [{ message: { role: 'user', content: 'Summarize' } }],
        },
        null,
      ),
      event(
        'model.request.started',
        { ...started('summary').data, purpose: 'compaction', inputMessageId: null },
        undefined,
        null,
      ),
      event(
        'model.request.completed',
        {
          modelRequestId: 'summary',
          status: 'failed',
          finishedAt: 30,
          durationMs: 10,
          firstResponseMs: null,
          error: 'Network failure',
        },
        undefined,
        null,
      ),
    ]);
    expect(store.listTrace('session', { purpose: 'compaction' }).items).toMatchObject([
      { kind: 'compaction', runId: null, status: 'failed' },
    ]);
    expect(store.getModelRequest('session', 'summary', { section: 'system' }).items[0]?.text).toBe(
      'Summary instructions',
    );
    expect(store.getSessionUsage('session')).toMatchObject({
      requestCount: 1,
      recordedRequests: 0,
      unknownRequests: 1,
      estimatedCostUsd: null,
      unknownPriceRequests: 1,
    });
    expect(() => store.getModelRequest('session', 'absent')).toThrow('does not belong');
    expect(() => store.getModelRequest('other-session', 'summary')).toThrow(
      'Session does not exist',
    );
  });

  it('classifies a request without a terminal record as interrupted on recovery', async () => {
    const value = await fixture();
    value.store.append('session', [prepared('pending'), started('pending')]);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.listTrace('session').items).toMatchObject([
      { id: 'pending', status: 'interrupted', durationMs: null },
    ]);
    expect(value.store.getModelRequest('session', 'pending').summary).toMatchObject({
      status: 'interrupted',
      usage: null,
      finishedAt: null,
    });
  });

  it('rejects mismatched or duplicate invocation terminals atomically', async () => {
    const { store } = await fixture();
    expect(() => store.append('session', [completed('unknown')])).toThrow('matching invocation');
    store.append('session', [prepared('known'), started('known'), completed('known')]);
    expect(() => store.append('session', [completed('known')])).toThrow('duplicated');
    expect(store.listTrace('session').items).toHaveLength(1);
  });
});
