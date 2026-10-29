import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  createAssistantMessageEventStream,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { openProfileStore, sessionLogDirectory } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { SessionRuntime } from '../src/sessions/runtime.js';
import type { RuntimeStore } from '../src/sessions/ports.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Expected runtime observation did not arrive');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
function userTexts(context: TranscriptContext): string[] {
  return context.messages.flatMap((message) =>
    message.role === 'user' && typeof message.content === 'string' ? [message.content] : [],
  );
}

async function fixture(
  options: {
    slow?: boolean;
    stream?: StreamFn;
    store?: (store: RuntimeStore) => RuntimeStore;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-runtime-'));
  const store = await openProfileStore(directory);
  const faux = fauxProvider({
    tokensPerSecond: options.slow ? 250 : 0,
    tokenSize: { min: 1, max: 3 },
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const errors: unknown[] = [];
  const runtime = new SessionRuntime({
    store: options.store ? options.store(store) : store,
    gateway: {
      resolve: () =>
        Promise.resolve({
          model: faux.models[0],
          streamFn: options.stream ?? models.streamSimple.bind(models),
          release: () => {},
        }),
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  let session;
  try {
    session = runtime.createSession({
      title: 'Test session',
      providerId: faux.provider.id,
      modelId: faux.models[0].id,
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
    });
  } catch (error) {
    await runtime.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    store,
    faux,
    models,
    errors,
    runtime,
    session,
    async close(): Promise<void> {
      await runtime.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('SessionRuntime durable execution', () => {
  it('publishes live text before notifying and persists only complete messages without duplicating accepted input', async () => {
    const f = await fixture();
    try {
      const contexts: string[][] = [];
      f.faux.setResponses([
        (context) => {
          contexts.push(userTexts(context));
          return fauxAssistantMessage('Persistent answer');
        },
      ]);
      const notified: number[] = [];
      const streamed: string[] = [];
      const unsubscribe = f.runtime.subscribe(f.session.id, (event) => {
        if (!('seq' in event)) {
          const snapshot = f.runtime.getSnapshot(f.session.id);
          expect(snapshot.liveRevision).toBeGreaterThan(0);
          streamed.push(snapshot.messages.at(-1)?.text ?? '');
          return;
        }
        expect(f.store.readEvents(f.session.id, event.seq - 1, 1)[0]?.eventId).toBe(event.eventId);
        notified.push(event.seq);
      });
      const accepted = await f.runtime.send(f.session.id, {
        text: 'Only once',
        mode: 'send',
        requestId: 'request-1',
      });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(contexts).toEqual([['Only once']]);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.messages.map(({ text }) => text)).toEqual(['Only once', 'Persistent answer']);
      expect(snapshot.runs[0]?.status).toBe('completed');
      const events = f.store.readEvents(f.session.id, 0, 1000);
      expect(events.some(({ type }) => type === 'message.delta')).toBe(false);
      expect(streamed.at(-1)).toBe('Persistent answer');
      expect(snapshot.liveRevision).toBe(0);
      const profile = await realpath(f.directory);
      const journal = await readFile(
        join(
          sessionLogDirectory(profile, join(profile, '.my-pi-harness')),
          `${f.session.id}.jsonl`,
        ),
        'utf8',
      );
      expect(journal).not.toContain('"message.delta"');
      expect(notified).toEqual([...notified].sort((a, b) => a - b));
      expect(
        await f.runtime.send(f.session.id, {
          text: 'Only once',
          mode: 'send',
          requestId: 'request-1',
        }),
      ).toEqual(accepted);
      expect(f.faux.state.callCount).toBe(1);
      unsubscribe();
      await f.runtime.close();
      f.store.close();
      const reopened = await openProfileStore(f.directory);
      try {
        expect(
          reopened.getModelContext(f.session.id, snapshot.session.activeBranchId),
        ).toHaveLength(2);
        expect(reopened.getSnapshot(f.session.id).messages).toEqual(snapshot.messages);
      } finally {
        reopened.close();
      }
    } finally {
      await f.close();
    }
  });

  it('rejects another send, edits/deletes queued inputs, and actually steers through Pi', async () => {
    const f = await fixture();
    const pending = gate();
    try {
      const contexts: string[][] = [];
      f.faux.setResponses([
        async (context) => {
          contexts.push(userTexts(context));
          await pending.promise;
          return fauxAssistantMessage('First');
        },
        (context) => {
          contexts.push(userTexts(context));
          return fauxAssistantMessage('Second');
        },
      ]);
      await f.runtime.send(f.session.id, { text: 'Initial', mode: 'send', requestId: 'initial' });
      await until(() => f.faux.state.callCount === 1);
      await expect(
        f.runtime.send(f.session.id, {
          text: 'Conflicting send',
          mode: 'send',
          requestId: 'conflict',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
      const queued = await f.runtime.send(f.session.id, {
        text: 'Original queued',
        mode: 'steer',
        requestId: 'queued',
      });
      const removed = await f.runtime.send(f.session.id, {
        text: 'Removed',
        mode: 'follow-up',
        requestId: 'removed',
      });
      expect(queued.inputId).toBeTypeOf('string');
      if (!queued.inputId || !removed.inputId) throw new Error('Expected queue acceptance');
      await f.runtime.updateQueue(f.session.id, queued.inputId, {
        text: 'Edited queued',
        revision: 1,
      });
      await expect(
        f.runtime.updateQueue(f.session.id, queued.inputId, { text: 'Stale edit', revision: 1 }),
      ).rejects.toMatchObject({ code: 'QUEUE_CONFLICT' });
      await f.runtime.deleteQueue(f.session.id, removed.inputId);
      pending.release();
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(contexts).toEqual([['Initial'], ['Initial', 'Edited queued']]);
      expect(f.runtime.getSnapshot(f.session.id).queue).toEqual([]);
      expect(f.store.findRequest(f.session.id, 'queued')).toEqual({
        inputId: queued.inputId,
        runId: null,
      });
      expect(f.faux.state.callCount).toBe(2);
    } finally {
      pending.release();
      await f.close();
    }
  });

  it('waits for cancellation, preserves pending queue across restart, and resumes only on explicit command', async () => {
    const f = await fixture({ slow: true });
    try {
      f.faux.setResponses([fauxAssistantMessage('A long answer '.repeat(300))]);
      await f.runtime.send(f.session.id, { text: 'Start', mode: 'send', requestId: 'start' });
      await until(() =>
        f.runtime
          .getSnapshot(f.session.id)
          .messages.some((message) => message.status === 'streaming' && message.text.length > 0),
      );
      const observed = f.runtime.getSnapshot(f.session.id).messages.at(-1);
      if (!observed || observed.status !== 'streaming')
        throw new Error('Expected a live assistant before queue mutation');
      await f.runtime.send(f.session.id, { text: 'Later', mode: 'follow-up', requestId: 'later' });
      const afterQueue = f.runtime.getSnapshot(f.session.id).messages.at(-1);
      expect(afterQueue?.id).toBe(observed.id);
      expect(afterQueue?.text.startsWith(observed.text)).toBe(true);
      const [first, second] = await Promise.all([
        f.runtime.cancel(f.session.id),
        f.runtime.cancel(f.session.id),
      ]);
      expect(first.session.activeRunId).toBeNull();
      expect(second.session.activeRunId).toBeNull();
      expect(first.runs[0]?.status).toBe('cancelled');
      expect(first.runs[0]?.error).toBeNull();
      expect(first.messages.at(-1)?.text.startsWith(observed.text)).toBe(true);
      expect(first.queue).toHaveLength(1);
      expect(f.faux.state.callCount).toBe(1);
      await f.runtime.close();
      f.store.close();
      const reopened = await openProfileStore(f.directory);
      const resumed = new SessionRuntime({
        store: reopened,
        gateway: {
          resolve: () =>
            Promise.resolve({
              model: f.faux.models[0],
              streamFn: f.models.streamSimple.bind(f.models),
              release: () => {},
            }),
        },
        onError: (error) => {
          f.errors.push(error);
        },
      });
      try {
        expect(resumed.getSnapshot(f.session.id).queue).toHaveLength(1);
        expect(resumed.getSnapshot(f.session.id).messages.at(-1)).toEqual(first.messages.at(-1));
        expect(f.faux.state.callCount).toBe(1);
        const contexts: string[][] = [];
        f.faux.setResponses([
          (context) => {
            contexts.push(userTexts(context));
            return fauxAssistantMessage('Resumed');
          },
        ]);
        await resumed.resumeQueue(f.session.id);
        await until(() => resumed.getSnapshot(f.session.id).session.activeRunId === null);
        expect(contexts).toEqual([['Start', 'Later']]);
        expect(resumed.getSnapshot(f.session.id).queue).toEqual([]);
      } finally {
        await resumed.close();
        reopened.close();
      }
    } finally {
      await f.close();
    }
  });

  it('creates an edited branch without mixing the old answer, and preserves the original branch', async () => {
    const f = await fixture();
    try {
      const contexts: string[][] = [];
      f.faux.setResponses([
        fauxAssistantMessage('Old answer'),
        (context) => {
          contexts.push(userTexts(context));
          return fauxAssistantMessage('New answer');
        },
      ]);
      await f.runtime.send(f.session.id, { text: 'Old input', mode: 'send', requestId: 'old' });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      const original = f.runtime.getSnapshot(f.session.id);
      const user = original.messages[0];
      if (!user) throw new Error('Missing original user message');
      await f.runtime.editAndResend(f.session.id, {
        messageId: user.id,
        text: 'New input',
        requestId: 'edit',
      });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(contexts).toEqual([['New input']]);
      expect(f.runtime.getSnapshot(f.session.id).messages.map(({ text }) => text)).toEqual([
        'New input',
        'New answer',
      ]);
      await f.runtime.selectBranch(f.session.id, original.session.activeBranchId);
      expect(f.runtime.getSnapshot(f.session.id).messages.map(({ text }) => text)).toEqual([
        'Old input',
        'Old answer',
      ]);
    } finally {
      await f.close();
    }
  });

  it('records provider failure as failed despite fulfilled SDK prompt, without publishing its private error', async () => {
    const f = await fixture();
    try {
      f.faux.setResponses([
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'private-test-key-error' }),
      ]);
      await f.runtime.send(f.session.id, { text: 'Fail', mode: 'send', requestId: 'failure' });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('failed');
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.error).toBe('模型请求失败，请稍后重试。');
      expect(JSON.stringify(f.store.readEvents(f.session.id, 0, 1000))).not.toContain(
        'private-test-key-error',
      );
    } finally {
      await f.close();
    }
  });

  it('records a safe timeout reason from the SDK final without retrying its model request', async () => {
    const f = await fixture();
    try {
      f.faux.setResponses([
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Request timed out.' }),
      ]);
      await f.runtime.send(f.session.id, { text: 'Timeout', mode: 'send', requestId: 'timeout' });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      const run = f.runtime.getSnapshot(f.session.id).runs[0];
      expect(run?.status).toBe('failed');
      expect(run?.error).toBe('模型请求超时，请稍后重试。');
      expect(f.faux.state.callCount).toBe(1);
    } finally {
      await f.close();
    }
  });

  for (const outcome of ['failed', 'cancelled'] as const) {
    it(`persists the observed partial body after ${outcome} even when the SDK final omits it`, async () => {
      let finish = (): void => undefined;
      const f = await fixture({
        stream: (_model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          const partial = fauxAssistantMessage(
            [
              {
                type: 'thinking',
                thinking: 'Observed reasoning',
                thinkingSignature: 'signed-observation',
              },
              { type: 'text', text: 'Observed partial answer' },
            ],
            { stopReason: 'pending' },
          );
          let finished = false;
          finish = (): void => {
            if (finished) return;
            finished = true;
            options?.signal?.removeEventListener('abort', finish);
            const stopReason = outcome === 'cancelled' ? 'aborted' : 'error';
            const terminal = fauxAssistantMessage('', { stopReason });
            stream.push({ type: 'error', reason: stopReason, error: terminal });
            stream.end(terminal);
          };
          options?.signal?.addEventListener('abort', finish, { once: true });
          stream.push({ type: 'start', partial: { ...partial, content: [] } });
          stream.push({
            type: 'thinking_delta',
            contentIndex: 0,
            delta: 'Observed reasoning',
            partial: { ...partial, content: partial.content.slice(0, 1) },
          });
          stream.push({
            type: 'text_delta',
            contentIndex: 1,
            delta: 'Observed partial answer',
            partial,
          });
          return stream;
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'Partial output',
          mode: 'send',
          requestId: 'partial-output',
        });
        await until(() => {
          const message = f.runtime.getSnapshot(f.session.id).messages.at(-1);
          return message?.status === 'streaming' && message.text.length > 0;
        });
        const live = f.runtime.getSnapshot(f.session.id).messages.at(-1);
        expect(live?.status).toBe('streaming');
        expect(live?.text).toBe('Observed partial answer');
        expect(live?.thinking).toBe('Observed reasoning');
        if (outcome === 'cancelled') await f.runtime.cancel(f.session.id);
        else finish();
        await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
        const snapshot = f.runtime.getSnapshot(f.session.id);
        const terminal = snapshot.messages.at(-1);
        expect(terminal).toMatchObject({
          id: live?.id,
          status: outcome,
          text: live?.text,
          thinking: live?.thinking,
          stopReason: outcome === 'cancelled' ? 'aborted' : 'error',
        });
        expect(terminal?.usage).toBeUndefined();
        expect(snapshot.runs[0]?.status).toBe(outcome);
        const events = f.store.readEvents(f.session.id, 0, 1000);
        expect(events.some(({ type }) => type === 'message.delta')).toBe(false);
        expect(events.filter(({ type }) => type === 'message.completed')).toHaveLength(1);
        await f.runtime.close();
        f.store.close();
        const reopened = await openProfileStore(f.directory);
        try {
          expect(reopened.getSnapshot(f.session.id).messages.at(-1)).toEqual(terminal);
          expect(
            reopened.getModelContext(f.session.id, snapshot.session.activeBranchId),
          ).toHaveLength(1);
        } finally {
          reopened.close();
        }
        const profile = await realpath(f.directory);
        const journal = await readFile(
          join(
            sessionLogDirectory(profile, join(profile, '.my-pi-harness')),
            `${f.session.id}.jsonl`,
          ),
          'utf8',
        );
        expect(journal).toContain('"thinkingSignature":"signed-observation"');
        expect(journal).not.toContain('"message.delta"');
      } finally {
        finish();
        await f.close();
      }
    });
  }

  it('aborts and disables a session on an event transaction failure rather than broadcasting completion', async () => {
    let failed = false;
    const f = await fixture({
      store: (actual) => ({
        createSession: (input) => actual.createSession(input),
        listSessions: () => actual.listSessions(),
        getSession: (id) => actual.getSession(id),
        getSnapshot: (id) => actual.getSnapshot(id),
        publishMessageDelta: (id, delta) => actual.publishMessageDelta(id, delta),
        readEvents: (id, after, limit) => actual.readEvents(id, after, limit),
        getModelContext: (id, branch) => actual.getModelContext(id, branch),
        findRequest: (id, request) => actual.findRequest(id, request),
        getQueueBranch: (id, input) => actual.getQueueBranch(id, input),
        getQueuePrivateData: (id, input) => actual.getQueuePrivateData(id, input),
        recoverInterrupted: () => actual.recoverInterrupted(),
        append: (id, events) => {
          if (events.some(({ type }) => type === 'message.completed')) {
            failed = true;
            throw new Error('Injected disk write failure');
          }
          return actual.append(id, events);
        },
      }),
    });
    try {
      f.faux.setResponses([fauxAssistantMessage('Will fail to persist')]);
      await f.runtime.send(f.session.id, { text: 'Start', mode: 'send', requestId: 'failure' });
      await until(() => failed && !f.runtime.isProviderActive(f.faux.provider.id));
      expect(
        f.store.readEvents(f.session.id, 0, 1000).some(({ type }) => type === 'run.finished'),
      ).toBe(false);
      expect(() =>
        f.runtime.send(f.session.id, { text: 'Retry', mode: 'send', requestId: 'retry' }),
      ).toThrow('Session persistence failed');
      expect(f.errors.length).toBeGreaterThan(0);
    } finally {
      await f.close();
    }
  });

  it('cleans an accepted run whose initial queue read fails and recovers it as interrupted without a model call', async () => {
    let accepted = false;
    const f = await fixture({
      store: (actual) => ({
        createSession: (input) => actual.createSession(input),
        listSessions: () => actual.listSessions(),
        getSession: (id) => actual.getSession(id),
        getSnapshot: (id) => {
          if (accepted) throw new Error('Injected post-accept read failure');
          return actual.getSnapshot(id);
        },
        publishMessageDelta: (id, delta) => actual.publishMessageDelta(id, delta),
        readEvents: (id, after, limit) => actual.readEvents(id, after, limit),
        getModelContext: (id, branch) => actual.getModelContext(id, branch),
        getQueueBranch: (id, input) => actual.getQueueBranch(id, input),
        getQueuePrivateData: (id, input) => actual.getQueuePrivateData(id, input),
        findRequest: (id, request) => actual.findRequest(id, request),
        recoverInterrupted: () => actual.recoverInterrupted(),
        append: (id, events) => {
          const result = actual.append(id, events);
          if (events.some(({ type }) => type === 'run.accepted')) accepted = true;
          return result;
        },
      }),
    });
    try {
      f.faux.setResponses([fauxAssistantMessage('Must not be requested')]);
      await expect(
        f.runtime.send(f.session.id, {
          text: 'Accept then fail',
          mode: 'send',
          requestId: 'initialization-failure',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' });
      expect(f.runtime.isProviderActive(f.faux.provider.id)).toBe(false);
      expect(f.faux.state.callCount).toBe(0);
      expect(() => f.runtime.getSnapshot(f.session.id)).toThrow('Session persistence failed');
      expect(() => f.runtime.getSessionSummary(f.session.id)).toThrow('Session persistence failed');
      expect(f.store.getSnapshot(f.session.id).runs[0]?.status).toBe('running');
      expect(
        f.store.readEvents(f.session.id, 0, 1000).some(({ type }) => type === 'run.finished'),
      ).toBe(false);
      await f.runtime.close();
      f.store.close();
      const reopened = await openProfileStore(f.directory);
      try {
        expect(reopened.getSnapshot(f.session.id).runs[0]?.status).toBe('interrupted');
        expect(reopened.getSnapshot(f.session.id).session.activeRunId).toBeNull();
      } finally {
        reopened.close();
      }
    } finally {
      await f.close();
    }
  });

  it('keeps cancelled inputs paused through ordinary sends and edits, and resumes only in their original branch', async () => {
    const f = await fixture({ slow: true });
    try {
      f.faux.setResponses([fauxAssistantMessage('A long answer '.repeat(300))]);
      await f.runtime.send(f.session.id, { text: 'Original', mode: 'send', requestId: 'original' });
      await until(() =>
        f.runtime
          .getSnapshot(f.session.id)
          .messages.some((message) => message.status === 'streaming' && message.text.length > 0),
      );
      await f.runtime.send(f.session.id, {
        text: 'Paused input',
        mode: 'follow-up',
        requestId: 'paused',
      });
      await f.runtime.cancel(f.session.id);
      const oldBranch = f.runtime.getSnapshot(f.session.id).session.activeBranchId;
      const contexts: string[][] = [];
      f.faux.setResponses([
        (context) => {
          contexts.push(userTexts(context));
          return fauxAssistantMessage('Fresh answer');
        },
        (context) => {
          contexts.push(userTexts(context));
          return fauxAssistantMessage('Edited answer');
        },
        (context) => {
          contexts.push(userTexts(context));
          return fauxAssistantMessage('Resumed answer');
        },
      ]);
      await f.runtime.send(f.session.id, { text: 'Fresh input', mode: 'send', requestId: 'fresh' });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(contexts).toEqual([['Original', 'Fresh input']]);
      const original = f.runtime.getSnapshot(f.session.id).messages[0];
      if (!original) throw new Error('Missing original input');
      await f.runtime.editAndResend(f.session.id, {
        messageId: original.id,
        text: 'Edited input',
        requestId: 'edited',
      });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(contexts).toEqual([['Original', 'Fresh input'], ['Edited input']]);
      expect(f.runtime.getSnapshot(f.session.id).queue).toHaveLength(1);
      await expect(f.runtime.resumeQueue(f.session.id)).rejects.toMatchObject({
        code: 'QUEUE_BRANCH_MISMATCH',
      });
      expect(f.faux.state.callCount).toBe(3);
      await f.runtime.selectBranch(f.session.id, oldBranch);
      await f.runtime.resumeQueue(f.session.id);
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(contexts[2]).toEqual(['Original', 'Fresh input', 'Paused input']);
      expect(f.runtime.getSnapshot(f.session.id).queue).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('keeps ownership of a new run accepted while the previous terminal event is being published', async () => {
    const f = await fixture();
    const second = gate();
    try {
      f.faux.setResponses([
        fauxAssistantMessage('First'),
        async () => {
          await second.promise;
          return fauxAssistantMessage('Second');
        },
      ]);
      let submitted = false;
      let next: Promise<unknown> | undefined;
      const unsubscribe = f.runtime.subscribe(f.session.id, (event) => {
        if (event.type === 'run.finished' && !submitted) {
          submitted = true;
          next = f.runtime.send(f.session.id, {
            text: 'Next input',
            mode: 'follow-up',
            requestId: 'next',
          });
        }
      });
      await f.runtime.send(f.session.id, { text: 'First input', mode: 'send', requestId: 'first' });
      await until(() => f.faux.state.callCount === 2);
      await next;
      expect(f.runtime.isProviderActive(f.faux.provider.id)).toBe(true);
      await expect(
        f.runtime.send(f.session.id, {
          text: 'Concurrent send',
          mode: 'send',
          requestId: 'concurrent',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
      second.release();
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(f.runtime.getSnapshot(f.session.id).runs.map(({ status }) => status)).toEqual([
        'completed',
        'completed',
      ]);
      unsubscribe();
    } finally {
      second.release();
      await f.close();
    }
  });
});
