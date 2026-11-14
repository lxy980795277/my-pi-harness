import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  normalizeContext,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import type { EventInput } from '../src/sessions/ports';
import { scheduledStream } from '../src/runs/request';
import { observedRequest, RequestAuditError } from '../src/runs/request-observer';
import { AgentRequestScheduler } from '../src/subagents/request-scheduler';
import { encodeContextMessage } from '../src/context/codec';

const model = fauxProvider().models[0];
const context = normalizeContext({ messages: [] });

function fixture() {
  const events: EventInput[] = [];
  let inputMessageId = 'original-input';
  return {
    events,
    observation: {
      branchId: 'branch',
      runId: 'run',
      providerId: 'provider',
      purpose: 'conversation' as const,
      inputMessageId: () => inputMessageId,
      commit: (records: readonly EventInput[]) => {
        events.push(...records);
      },
      prepare: (modelRequestId: string) => {
        events.push({
          type: 'context.prepared',
          runId: 'run',
          at: Date.now(),
          data: { branchId: 'branch', modelRequestId },
        });
      },
    },
    changeInput: (id: string) => {
      inputMessageId = id;
    },
  };
}

function terminal(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  stream.end(message);
  return stream;
}

describe('one durable observation per actual model request', () => {
  it('preserves one iterator, freezes consumed input and commits usage before terminal consumption', async () => {
    const f = fixture();
    const stream = createAssistantMessageEventStream();
    const iterate = vi.spyOn(stream, Symbol.asyncIterator);
    const message = {
      ...fauxAssistantMessage('complete'),
      responseId: 'response',
      usage: {
        input: 10,
        output: 2,
        cacheRead: 4,
        cacheWrite: 0,
        totalTokens: 16,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const output = await observedRequest(() => stream, f.observation, Date.now())(model, context);
    f.changeInput('later-input');
    const iterator = output[Symbol.asyncIterator]();
    const first = iterator.next();
    stream.push({ type: 'text_delta', contentIndex: 0, delta: 'complete', partial: message });
    await expect(first).resolves.toMatchObject({ value: { type: 'text_delta' } });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    expect(await output.result()).toBe(message);
    await iterator.next();
    await iterator.next();
    expect(iterate).toHaveBeenCalledTimes(1);
    expect(f.events.map((event) => event.type)).toEqual([
      'context.prepared',
      'model.request.started',
      'model.request.completed',
    ]);
    const id = f.events[0]?.data.modelRequestId;
    expect(id).toEqual(expect.any(String));
    expect(f.events[1]?.data).toMatchObject({
      modelRequestId: id,
      inputMessageId: 'original-input',
    });
    expect(f.events[2]?.data).toMatchObject({
      modelRequestId: id,
      status: 'completed',
      responseId: 'response',
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, totalTokens: 16 },
    });
    expect(f.events[2]?.data.firstResponseMs).toEqual(expect.any(Number));
  });

  it.each([
    { reason: 'stop', status: 'completed' },
    { reason: 'error', status: 'failed' },
  ] as const)(
    'records a buffered $reason response before its iterator is consumed',
    async ({ reason, status }) => {
      const f = fixture();
      const message = { ...fauxAssistantMessage('buffered response'), stopReason: reason };
      const stream = createAssistantMessageEventStream();
      const iterate = vi.spyOn(stream, Symbol.asyncIterator);
      stream.push({
        type: 'text_delta',
        contentIndex: 0,
        delta: 'buffered response',
        partial: message,
      });
      if (reason === 'stop') stream.push({ type: 'done', reason, message });
      else stream.push({ type: 'error', reason, error: message });
      stream.end(message);
      let monotonic = 100;
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
      try {
        const output = await observedRequest(
          () => {
            monotonic = 125;
            return stream;
          },
          f.observation,
          Date.now(),
        )(model, context);
        expect(await output.result()).toBe(message);
        expect(iterate).not.toHaveBeenCalled();
        expect(f.events.at(-1)?.data).toMatchObject({ status, firstResponseMs: 25 });
        monotonic = 200;
        const received = [];
        for await (const event of output) received.push(event.type);
        expect(received).toEqual(['text_delta', reason === 'stop' ? 'done' : 'error']);
        expect(iterate).toHaveBeenCalledTimes(1);
        expect(f.events.filter((event) => event.type === 'model.request.completed')).toHaveLength(
          1,
        );
        expect(f.events.at(-1)?.data.firstResponseMs).toBe(25);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it('settles a result-only consumer and its admission without creating an iterator', async () => {
    const f = fixture();
    const stream = createAssistantMessageEventStream();
    const iterate = vi.spyOn(stream, Symbol.asyncIterator);
    const release = vi.fn();
    const completions: Promise<void>[] = [];
    const output = await scheduledStream(
      () => stream,
      {
        acquireRequest: () => Promise.resolve(release),
        trackRequest: (completion) => {
          completions.push(completion);
        },
      },
      () => undefined,
      f.observation,
    )(model, context);
    expect(release).not.toHaveBeenCalled();
    expect(f.events.some((event) => event.type === 'model.request.completed')).toBe(false);
    const message = fauxAssistantMessage('terminal without iterator events');
    stream.end(message);
    expect(await output.result()).toBe(message);
    await Promise.all(completions);
    expect(iterate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(f.events.at(-1)?.data.status).toBe('completed');
    expect(f.events.at(-1)?.data.firstResponseMs).toEqual(expect.any(Number));
  });

  it.each(['callback', 'event'] as const)(
    'retains the earlier %s response time when the terminal result arrives',
    async (source) => {
      const f = fixture();
      const stream = createAssistantMessageEventStream();
      const message = fauxAssistantMessage('response');
      const callback = vi.fn();
      const response = { status: 200, headers: {} };
      let monotonic = 100;
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
      try {
        const output = await observedRequest(
          async (requestModel, _context, options) => {
            if (source === 'callback') {
              monotonic = 110;
              await options?.onResponse?.(response, requestModel);
            }
            return stream;
          },
          f.observation,
          Date.now(),
        )(model, context, { onResponse: callback });
        const iterator = output[Symbol.asyncIterator]();
        const start = iterator.next();
        monotonic = 115;
        stream.push({ type: 'start', partial: message });
        await start;
        const delta = iterator.next();
        monotonic = 125;
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'response', partial: message });
        await delta;
        monotonic = 150;
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
        await output.result();
        await iterator.next();
        await iterator.next();
        expect(f.events.at(-1)?.data.firstResponseMs).toBe(source === 'callback' ? 10 : 25);
        if (source === 'callback') {
          expect(callback).toHaveBeenCalledExactlyOnceWith(response, model);
        } else expect(callback).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    },
  );

  it.each([
    { reason: 'error', status: 'failed' },
    { reason: 'aborted', status: 'cancelled' },
    { reason: 'deferred', status: 'failed' },
    { reason: 'toolUse', status: 'completed' },
  ] as const)('uses the resolved $reason result to record $status', async ({ reason, status }) => {
    const f = fixture();
    const message = {
      ...fauxAssistantMessage(''),
      stopReason: reason,
      errorMessage: '401 Authorization: Bearer secret-do-not-log',
    };
    const output = await observedRequest(
      () => terminal(message),
      f.observation,
      Date.now(),
    )(model, context);
    await output.result();
    expect(f.events.at(-1)?.data).toMatchObject({ status });
    expect(f.events.at(-1)?.data.usage).toBeUndefined();
    expect(JSON.stringify(f.events)).not.toContain('secret-do-not-log');
  });

  it('records a rejected invocation without exposing the transport error payload', async () => {
    const f = fixture();
    const cause = new Error('request key=private-do-not-log');
    await expect(
      observedRequest(() => Promise.reject(cause), f.observation, Date.now())(model, context),
    ).rejects.toBe(cause);
    expect(f.events.at(-1)?.data).toMatchObject({ status: 'failed', firstResponseMs: null });
    expect(JSON.stringify(f.events)).not.toContain('private-do-not-log');
  });

  it('omits an overlong public response id while retaining the original SDK codec value', async () => {
    const f = fixture();
    const message = { ...fauxAssistantMessage('complete'), responseId: 'r'.repeat(161) };
    const result = await observedRequest(
      () => terminal(message),
      f.observation,
      Date.now(),
    )(model, context);
    await result.result();
    expect(f.events.at(-1)?.data.status).toBe('completed');
    expect(f.events.at(-1)?.data.responseId).toBeUndefined();
    expect(encodeContextMessage(message)).toMatchObject({
      message: { responseId: message.responseId },
    });
  });

  it('measures admission and execution with a monotonic clock while wall timestamps move backwards', async () => {
    let wall = 2000;
    let monotonic = 100;
    const date = vi.spyOn(Date, 'now').mockImplementation(() => wall);
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    try {
      const f = fixture();
      let released = false;
      const result = await scheduledStream(
        () => {
          wall = 1800;
          monotonic = 135;
          return terminal(fauxAssistantMessage('complete'));
        },
        {
          acquireRequest: () => {
            wall = 1900;
            monotonic = 112;
            return Promise.resolve(() => {
              released = true;
            });
          },
          trackRequest: () => undefined,
        },
        () => undefined,
        f.observation,
      )(model, context);
      await result.result();
      expect(f.events[1]?.data).toMatchObject({
        queuedAt: 2000,
        startedAt: 1900,
        queueDurationMs: 12,
      });
      expect(f.events[2]?.data).toMatchObject({
        finishedAt: 1800,
        durationMs: 23,
        status: 'completed',
      });
      expect(released).toBe(true);
    } finally {
      clock.mockRestore();
      date.mockRestore();
    }
  });

  it('records a frozen catalog estimate for reported partial failure usage and excludes model headers', async () => {
    const f = fixture();
    const priced = {
      ...model,
      headers: { Authorization: 'Bearer private-model-header' },
      cost: { input: 2, output: 4, cacheRead: 0.5, cacheWrite: 2.5 },
    };
    const message: AssistantMessage = {
      ...fauxAssistantMessage('partial'),
      stopReason: 'error',
      usage: {
        input: 10,
        output: 2,
        cacheRead: 4,
        cacheWrite: 6,
        cacheWrite1h: 2,
        totalTokens: 22,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const result = await observedRequest(
      () => {
        priced.cost.input = 1000;
        return terminal(message);
      },
      { ...f.observation, priceSource: 'pi-catalog', answerInputMessageId: () => 'root-answer' },
      Date.now(),
    )(priced, context);
    await result.result();
    expect(f.events[1]).toMatchObject({
      data: { answerInputMessageId: 'root-answer' },
      privateData: {
        priceSnapshot: { source: 'pi-catalog', currency: 'USD', rates: { input: 2 } },
      },
    });
    expect(f.events.at(-1)?.data).toMatchObject({
      status: 'failed',
      cacheWrite1h: 2,
      costEstimate: { source: 'pi-catalog', currency: 'USD' },
    });
    const cost: unknown = f.events.at(-1)?.data.costEstimate;
    expect(cost).toHaveProperty('input', expect.closeTo(0.00002, 12));
    expect(cost).toHaveProperty('output', expect.closeTo(0.000008, 12));
    expect(cost).toHaveProperty('cacheRead', expect.closeTo(0.000002, 12));
    expect(cost).toHaveProperty('cacheWrite', expect.closeTo(0.000018, 12));
    expect(JSON.stringify(f.events)).not.toContain('private-model-header');
  });

  it('does not call the provider when its prepared audit cannot commit', async () => {
    const f = fixture();
    const provider = vi.fn(() => terminal(fauxAssistantMessage('must not run')));
    await expect(
      observedRequest(
        provider,
        {
          ...f.observation,
          prepare: () => {
            throw new Error('disk unavailable');
          },
        },
        Date.now(),
      )(model, context),
    ).rejects.toBeInstanceOf(RequestAuditError);
    expect(provider).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });

  it('holds admission until the actual terminal record and releases after audit failure', async () => {
    const f = fixture();
    const scheduler = new AgentRequestScheduler(1);
    const signal = new AbortController();
    const stream = createAssistantMessageEventStream();
    const completions: Promise<void>[] = [];
    const failed = vi.fn();
    const output = await scheduledStream(
      () => stream,
      {
        acquireRequest: (abort) => scheduler.request([], abort),
        trackRequest: (completion) => {
          completions.push(completion);
        },
      },
      failed,
      {
        ...f.observation,
        commit: (events) => {
          if (events[0]?.type === 'model.request.completed') throw new Error('write failed');
          f.observation.commit(events);
        },
      },
    )(model, context, { signal: signal.signal });
    let admitted = false;
    const waiting = scheduler.request([], signal.signal).then((release) => {
      admitted = true;
      release();
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    stream.end(fauxAssistantMessage('terminal'));
    await expect(output.result()).rejects.toBeInstanceOf(RequestAuditError);
    await Promise.all(completions);
    await waiting;
    expect(failed).toHaveBeenCalledOnce();
  });

  it('cancels an admission waiter before preparing or recording an actual request', async () => {
    const f = fixture();
    const scheduler = new AgentRequestScheduler(1);
    const signal = new AbortController();
    const occupied = await scheduler.request([], signal.signal);
    const cancelled = new AbortController();
    const provider = vi.fn(() => terminal(fauxAssistantMessage('must not run')));
    const pending = scheduledStream(
      provider,
      { acquireRequest: (abort) => scheduler.request([], abort), trackRequest: () => undefined },
      () => undefined,
      f.observation,
    )(model, context, { signal: cancelled.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_CANCELLED' });
    cancelled.abort();
    await rejected;
    occupied();
    expect(provider).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });
});
