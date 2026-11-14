import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  MessageUsage,
  ModelRequestPurpose,
  ToolCallRecord,
  WorkState,
} from '@my-pi-harness/protocol';
import { initialWorkState } from '@my-pi-harness/protocol';
import type { EventInput } from '@my-pi-harness/protocol/internal';
import { openProfileStore, type ProfileStore } from '../src/index';
import { storedToolCallId } from '../src/sessions/projections/tool-intents';
import {
  createAgentSession,
  event,
  spawn,
  user,
  codec,
  run,
  type AgentSessionFixture,
} from './fixtures/agent-session';

interface InvocationOptions {
  branchId?: string;
  runId?: string | null;
  inputId?: string | null;
  answerId?: string | null;
  purpose?: ModelRequestPurpose;
  startedAt?: number;
  queuedAt?: number;
  queueDurationMs?: number;
  finishedAt?: number;
  durationMs?: number;
  usage?: MessageUsage | null;
  price?: 'known' | 'unknown';
  estimate?: number;
  catalogVersion?: string;
}
interface ToolFixture {
  record: ToolCallRecord;
  anchor: string;
  callId: string;
}

const owned: AgentSessionFixture[] = [];
const reported: MessageUsage = {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadTokens: 5,
  cacheWriteTokens: 3,
  totalTokens: 20,
};

async function fixture(): Promise<AgentSessionFixture> {
  const value = await createAgentSession();
  owned.push(value);
  return value;
}
function invocation(store: ProfileStore, id: string, options: InvocationOptions = {}): void {
  const runId = options.runId === undefined ? 'root' : options.runId;
  const startedAt = options.startedAt ?? 100;
  const usage = options.usage === undefined ? reported : options.usage;
  const version = options.catalogVersion ?? '1.4.0';
  const start: EventInput = {
    type: 'model.request.started',
    runId,
    at: startedAt,
    data: {
      modelRequestId: id,
      branchId: options.branchId ?? 'main',
      purpose: options.purpose ?? 'conversation',
      inputMessageId: options.inputId === undefined ? 'root-user' : options.inputId,
      answerInputMessageId: options.answerId === undefined ? 'root-user' : options.answerId,
      providerId: 'provider',
      modelId: 'model',
      queuedAt: options.queuedAt ?? startedAt - 3,
      startedAt,
      queueDurationMs: options.queueDurationMs ?? 3,
    },
    privateData: {
      priceSnapshot:
        options.price === 'known'
          ? {
              source: 'pi-catalog',
              catalogVersion: version,
              currency: 'USD',
              rates: {
                input: 1,
                output: 2,
                cacheRead: 0.1,
                cacheWrite: 1.5,
                tiers: [
                  { inputTokensAbove: 10000, input: 2, output: 4, cacheRead: 0.2, cacheWrite: 3 },
                ],
              },
            }
          : { source: 'unknown' },
    },
  };
  const finishedAt = options.finishedAt ?? startedAt + 20;
  const finish: EventInput = {
    type: 'model.request.completed',
    runId,
    at: finishedAt,
    data: {
      modelRequestId: id,
      status: 'completed',
      finishedAt,
      durationMs: options.durationMs ?? 20,
      firstResponseMs: 2,
      error: null,
      ...(usage === null ? {} : { usage }),
      ...(options.estimate === undefined
        ? {}
        : {
            costEstimate: {
              source: 'pi-catalog',
              catalogVersion: version,
              currency: 'USD',
              input: options.estimate,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: options.estimate,
            },
          }),
    },
  };
  store.append('session', [start, finish]);
}

function requestTool(
  store: ProfileStore,
  id: string,
  name: string,
  at: number,
  status: ToolCallRecord['status'] = 'running',
  mcp = false,
): ToolFixture {
  const anchor = `assistant-${id}`;
  const callId = `call-${id}`;
  const args = name === 'web_search' ? { query: 'Fixture' } : {};
  const record: ToolCallRecord = {
    id: storedToolCallId('root', anchor, callId),
    sessionId: 'session',
    branchId: 'main',
    runId: 'root',
    name,
    arguments: args,
    binding: mcp
      ? {
          kind: 'accepted',
          source: { kind: 'mcp', serverId: id, serverRevision: 1, remoteToolName: name },
          fingerprint: 'a'.repeat(64),
        }
      : { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
    dispatch: mcp ? { state: 'not_started' } : { state: 'not_applicable' },
    status,
    summary: name,
    result: null,
    diff: null,
    createdAt: at,
    updatedAt: at,
  };
  store.append('session', [
    event(
      'message.started',
      { ...user(anchor, 'root', ''), role: 'assistant', stopReason: 'toolUse', createdAt: at },
      'root',
      {
        codecVersion: 1,
        sdkVersion: '1.4.0',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: callId, name, arguments: args }],
        },
      },
    ),
    { ...event('tool.requested', { tool: record }, 'root'), at },
  ]);
  return { record, anchor, callId };
}

function finishTool(
  store: ProfileStore,
  tool: ToolFixture,
  at: number,
  status: 'completed' | 'denied' | 'cancelled' | 'unknown' = 'completed',
): void {
  const record = { ...tool.record, status, updatedAt: at, result: 'Finished' };
  store.append('session', [
    { ...event('tool.updated', { tool: record }, 'root'), at },
    {
      ...event(
        'tool.context',
        { branchId: 'main', afterMessageId: tool.anchor, toolCallId: record.id },
        'root',
        {
          toolResultVersion: 1,
          providerCallId: tool.callId,
          toolName: record.name,
          content: [{ type: 'text', text: 'Finished' }],
          isError: status !== 'completed',
          at,
          origin:
            tool.record.binding.kind === 'accepted' && tool.record.binding.source.kind === 'mcp'
              ? status === 'completed'
                ? 'server'
                : 'host'
              : 'tool',
          outcome: status,
        },
      ),
      at,
    },
  ]);
}

afterEach(async () => {
  for (const value of owned.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('unique-request execution accounting', () => {
  it('counts catalogue zero estimates, missing usage and unknown pricing independently', async () => {
    const { store } = await fixture();
    invocation(store, 'priced-zero', { price: 'known', estimate: 0 });
    invocation(store, 'priced-no-usage', {
      price: 'known',
      usage: null,
      purpose: 'approval',
      startedAt: 140,
    });
    invocation(store, 'custom', { price: 'unknown', purpose: 'compaction', startedAt: 180 });
    const total = store.getSessionUsage('session');
    expect(total).toMatchObject({
      requestCount: 3,
      recordedRequests: 2,
      unknownRequests: 1,
      pricedRequests: 2,
      unknownPriceRequests: 1,
      estimatedRequests: 1,
      unknownEstimateRequests: 2,
      estimatedCostUsd: 0,
      costComplete: false,
      costScope: 'model-requests',
      timedRequests: 3,
      unknownDurationRequests: 0,
      modelDurationMs: 60,
      queueDurationMs: 9,
      timedQueueRequests: 3,
      tokens: {
        inputTokens: 20,
        outputTokens: 4,
        cacheReadTokens: 10,
        cacheWriteTokens: 6,
        totalTokens: 40,
      },
    });
    expect(total.byPurpose).toMatchObject([
      { purpose: 'conversation', estimatedRequests: 1, estimatedCostUsd: 0 },
      { purpose: 'approval', recordedRequests: 0 },
      { purpose: 'compaction', estimatedRequests: 0 },
    ]);
    expect(store.getModelRequest('session', 'priced-zero').summary).toMatchObject({
      pricingSource: 'pi-catalog',
      pricingCatalogVersion: '1.4.0',
      costEstimate: { total: 0 },
    });
    expect(store.getModelRequest('session', 'custom').summary).toMatchObject({
      pricingSource: 'unknown',
      costEstimate: null,
    });
  });

  it('retains request-time estimates across new catalogue prices and restart', async () => {
    const value = await fixture();
    invocation(value.store, 'old-price', {
      price: 'known',
      estimate: 0.25,
      catalogVersion: '1.4.0',
    });
    invocation(value.store, 'new-price', {
      price: 'known',
      estimate: 0.75,
      catalogVersion: 'next-catalogue',
      startedAt: 150,
    });
    expect(value.store.getSessionUsage('session')).toMatchObject({
      estimatedCostUsd: 1,
      costComplete: true,
      estimatedRequests: 2,
    });
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getSessionUsage('session')).toMatchObject({
      estimatedCostUsd: 1,
      costComplete: true,
    });
    expect(value.store.getModelRequest('session', 'old-price').summary).toMatchObject({
      pricingCatalogVersion: '1.4.0',
      costEstimate: { total: 0.25 },
    });
  });

  it('uses the same unique leaves for task summaries, self, subtree and frozen answer attribution', async () => {
    const { store } = await fixture();
    invocation(store, 'root-first');
    spawn(store, 'first');
    invocation(store, 'first', { runId: 'run-first', inputId: 'user-first' });
    spawn(store, 'nested', 'run-first');
    invocation(store, 'nested', {
      runId: 'run-nested',
      inputId: 'user-nested',
      usage: { ...reported, totalTokens: 30 },
    });
    spawn(store, 'sibling');
    invocation(store, 'sibling', {
      runId: 'run-sibling',
      inputId: 'user-sibling',
      usage: { ...reported, totalTokens: 900000 },
    });
    expect(store.getAgentTask('session', 'first')).toMatchObject({
      usage: { totalTokens: 50 },
      usageCoverage: { requestCount: 2, recordedRequests: 2, unknownRequests: 0 },
    });
    expect(
      store.getSessionUsage('session', { taskId: 'first', includeDescendants: false }).tokens
        .totalTokens,
    ).toBe(20);
    expect(
      store.getSessionUsage('session', { taskId: 'first', includeDescendants: true }).tokens
        .totalTokens,
    ).toBe(50);
    expect(
      store.getSessionUsage('session', { runId: 'run-first', includeDescendants: true }).tokens
        .totalTokens,
    ).toBe(50);
    store.append('session', [
      event(
        'message.started',
        user('next-root-input', 'root', 'Continue'),
        'root',
        codec('Continue'),
      ),
    ]);
    invocation(store, 'next-root', {
      inputId: 'next-root-input',
      answerId: 'next-root-input',
      startedAt: 200,
    });
    invocation(store, 'old-child-finishes-late', {
      runId: 'run-first',
      inputId: 'user-first',
      startedAt: 250,
    });
    invocation(store, 'child-new-continuation', {
      runId: 'run-first',
      inputId: 'user-first',
      answerId: 'next-root-input',
      startedAt: 300,
    });
    expect(
      store.getSessionUsage('session', { inputMessageId: 'root-user', includeDescendants: true }),
    ).toMatchObject({ requestCount: 5, tokens: { totalTokens: 900090 } });
    expect(
      store.getSessionUsage('session', {
        inputMessageId: 'next-root-input',
        includeDescendants: true,
      }),
    ).toMatchObject({ requestCount: 2, tokens: { totalTokens: 40 } });
    expect(
      store.getSessionUsage('session', { inputMessageId: 'root-user', includeDescendants: false })
        .requestCount,
    ).toBe(1);
    expect(store.getSessionUsage('session').requestCount).toBe(7);
  });

  it('adds non-overlapping execution intervals while excluding idle time between root Runs', async () => {
    const { store } = await fixture();
    invocation(store, 'first', { startedAt: 10, finishedAt: 30 });
    store.append('session', [
      {
        ...event('run.finished', { status: 'completed', finishedAt: 100, error: null }, 'root'),
        at: 100,
      },
    ]);
    store.append('session', [
      event(
        'run.accepted',
        { run: { ...run('second'), createdAt: 200 }, requestId: 'second' },
        'second',
      ),
      event(
        'message.started',
        { ...user('second-input', 'second', 'Next'), createdAt: 200 },
        'second',
        codec('Next'),
      ),
    ]);
    invocation(store, 'second-model', {
      runId: 'second',
      inputId: 'second-input',
      answerId: 'second-input',
      startedAt: 210,
      finishedAt: 230,
    });
    store.append('session', [
      {
        ...event('run.finished', { status: 'completed', finishedAt: 260, error: null }, 'second'),
        at: 260,
      },
    ]);
    expect(store.getSessionUsage('session')).toMatchObject({
      wallDurationMs: 158,
      wallTimeBasis: 'execution-union',
      modelDurationMs: 40,
    });
    expect(store.getSessionUsage('session', { inputMessageId: 'second-input' })).toMatchObject({
      wallDurationMs: 60,
      wallTimeBasis: 'answer-span',
    });
  });

  it('keeps monotonic durations through wall-clock rollback and rejects forged answer sources', async () => {
    const { store } = await fixture();
    invocation(store, 'clock-rollback', {
      startedAt: 100,
      queuedAt: 110,
      queueDurationMs: 7,
      finishedAt: 80,
      durationMs: 30,
    });
    expect(store.getSessionUsage('session')).toMatchObject({
      modelDurationMs: 30,
      queueDurationMs: 7,
      wallDurationMs: null,
    });
    expect(() => invocation(store, 'forged', { answerId: 'unknown-input' })).toThrow(
      'Answer source',
    );
    spawn(store, 'child');
    expect(() => invocation(store, 'child-as-root', { answerId: 'user-child' })).toThrow(
      'root input',
    );
  });

  it('measures actual approval/question intervals and excludes refused external dispatches', async () => {
    const { store } = await fixture();
    invocation(store, 'source', { startedAt: 10, finishedAt: 20 });
    const denied = requestTool(store, 'denied-mcp', 'remote', 30, 'awaiting_approval', true);
    finishTool(store, denied, 50, 'denied');
    const ask = requestTool(store, 'question', 'ask_user', 60);
    const state: WorkState = {
      ...initialWorkState('main'),
      revision: 1,
      questions: [
        {
          id: 'question',
          runId: 'root',
          branchId: 'main',
          toolCallId: ask.record.id,
          questions: [
            {
              id: 'choice',
              header: 'Choice',
              prompt: 'Choose',
              options: [],
              multiSelect: false,
              allowCustomInput: true,
            },
          ],
          status: 'pending',
          answers: null,
          createdAt: 65,
        },
      ],
    };
    store.append('session', [{ ...event('work.updated', { state }, 'root'), at: 65 }]);
    expect(store.getSessionUsage('session')).toMatchObject({
      humanWaitMs: 20,
      unknownHumanWaits: 1,
      externalServices: [],
    });
    store.append('session', [
      {
        ...event(
          'work.updated',
          {
            state: {
              ...state,
              revision: 2,
              questions: state.questions.map((question) => ({
                ...question,
                status: 'answered',
                answers: [{ questionId: 'choice', optionIds: [], text: 'Yes' }],
              })),
            },
          },
          'root',
        ),
        at: 95,
      },
    ]);
    finishTool(store, ask, 100);
    const web = requestTool(store, 'web', 'web_search', 110);
    finishTool(store, web, 130);
    expect(store.getSessionUsage('session')).toMatchObject({
      toolCalls: 3,
      timedToolCalls: 3,
      toolDurationMs: 60,
      humanWaitMs: 50,
      unknownHumanWaits: 0,
      externalServices: [
        {
          service: 'deepseek-web',
          invocations: 1,
          estimatedCostUsd: null,
          costStatus: 'unavailable',
        },
      ],
    });
  });

  it('keeps reversed tool and human-wait clocks unknown instead of reporting zero', async () => {
    const { store } = await fixture();
    invocation(store, 'source', { startedAt: 10, finishedAt: 20 });
    const running = requestTool(store, 'clock-tool', 'web_search', 200);
    finishTool(store, running, 190);
    const waiting = requestTool(store, 'clock-wait', 'remote', 300, 'awaiting_approval', true);
    finishTool(store, waiting, 290, 'denied');
    store.append('session', [
      {
        ...event('run.finished', { status: 'completed', finishedAt: 400, error: null }, 'root'),
        at: 400,
      },
    ]);
    const total = store.getSessionUsage('session');
    expect(total).toMatchObject({
      modelDurationMs: 20,
      queueDurationMs: 3,
      timedToolCalls: 0,
      unknownToolDurationCalls: 2,
      toolDurationMs: 0,
      humanWaitMs: 0,
      unknownHumanWaits: 1,
      wallDurationMs: null,
    });
    expect(
      store.listTrace('session', { kind: 'tool' }).items.every((item) => item.durationMs === null),
    ).toBe(true);
  });

  it('charges shared branch history once and scopes branch totals to actual invocations', async () => {
    const { store } = await fixture();
    invocation(store, 'first-answer', { startedAt: 10 });
    store.append('session', [
      event(
        'message.started',
        user('second-input', 'root', 'Edit later'),
        'root',
        codec('Edit later'),
      ),
    ]);
    invocation(store, 'second-answer', {
      inputId: 'second-input',
      answerId: 'second-input',
      startedAt: 50,
    });
    store.append('session', [
      {
        ...event('run.finished', { status: 'completed', finishedAt: 100, error: null }, 'root'),
        at: 100,
      },
      event('branch.created', {
        id: 'edited',
        sessionId: 'session',
        parentId: 'main',
        forkMessageId: 'second-input',
        createdAt: 110,
      }),
      event('branch.selected', { branchId: 'edited' }),
      event(
        'run.accepted',
        { run: { ...run('edited-run'), branchId: 'edited', createdAt: 120 }, requestId: 'edit' },
        'edited-run',
      ),
      event(
        'message.started',
        { ...user('edited-input', 'edited-run', 'Edited'), branchId: 'edited', createdAt: 120 },
        'edited-run',
        codec('Edited'),
      ),
    ]);
    invocation(store, 'edited-answer', {
      branchId: 'edited',
      runId: 'edited-run',
      inputId: 'edited-input',
      answerId: 'edited-input',
      startedAt: 130,
    });
    expect(store.getSessionUsage('session')).toMatchObject({
      requestCount: 3,
      tokens: { totalTokens: 60 },
    });
    expect(store.getSessionUsage('session', { branchId: 'main' }).requestCount).toBe(2);
    expect(store.getSessionUsage('session', { branchId: 'edited' }).requestCount).toBe(1);
    expect(
      store.getSnapshot('session').messages.some((message) => message.id === 'root-user'),
    ).toBe(true);
  });

  it('bounds external service groups and reports omitted invocation counts', async () => {
    const { store } = await fixture();
    invocation(store, 'source', { startedAt: 10, finishedAt: 20 });
    for (let index = 0; index < 201; index += 1) {
      const at = 100 + index * 10;
      const tool = requestTool(store, `server-${index}`, 'remote', at, 'running', true);
      tool.record = {
        ...tool.record,
        dispatch: { state: 'may_have_started', attemptId: `attempt-${index}`, at: at + 1 },
        updatedAt: at + 1,
      };
      store.append('session', [
        { ...event('tool.updated', { tool: tool.record }, 'root'), at: at + 1 },
      ]);
      finishTool(store, tool, at + 2);
    }
    const total = store.getSessionUsage('session');
    expect(total.externalServices).toHaveLength(200);
    expect(total).toMatchObject({
      externalServicesOmitted: 1,
      omittedExternalInvocations: 1,
      toolCalls: 201,
    });
    expect(
      total.externalServices.every(
        (service) => service.invocations === 1 && service.estimatedCostUsd === null,
      ),
    ).toBe(true);
  }, 20_000);
});
