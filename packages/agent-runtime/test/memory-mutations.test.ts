import { createHash } from 'node:crypto';
import {
  fauxAssistantMessage,
  getCurrentTools,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import type { MemoryMutationResult, MemorySaveInput, MessageView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import type { RunMemoryMutationContext, RunMemoryPort } from '../src/runs/ports';
import { consumedMemorySource, memoryToolHandlers } from '../src/runs/memory';
import { RuntimeError } from '../src/errors';
import { agentFixture, agentGate, agentsIdle, firstTask } from './support/agent-fixture';
import { call } from './support/work-fixture';
import { delegate, hasResult, waitForResults } from './support/agent-tools';

const input: MemorySaveInput = {
  scope: 'user',
  category: 'preference',
  body: 'Use concise replies',
};
const result: MemoryMutationResult = {
  entry: null,
  receipt: {
    requestId: 'receipt',
    operation: 'create',
    memoryId: 'memory',
    revision: 1,
    status: 'applied',
  },
};
const base: RunMemoryPort = {
  saveMemory: () => Promise.resolve(result),
  learnMemory: () => Promise.resolve(result),
  updateMemory: () => Promise.resolve(result),
  deleteMemory: () => Promise.resolve(result),
  readSnapshot: () => Promise.resolve({ fingerprint: 'a'.repeat(64), entries: [] }),
  isCurrent: () => true,
  canUse: () => true,
  searchMemories: () => Promise.resolve({ entries: [], mode: 'lexical', truncated: false }),
};
const message: MessageView = {
  id: 'human',
  sessionId: 'session',
  branchId: 'branch',
  runId: 'run',
  role: 'user',
  text: 'Actual human input',
  thinking: 'Not input',
  attachmentIds: ['untrusted'],
  createdAt: 1,
  status: 'complete',
  stopReason: null,
};

function names(context: TranscriptContext): string[] {
  return getCurrentTools(context.messages).map(({ name }) => name);
}

describe('direct memory mutation runtime', () => {
  it('binds human text only, excludes agent messages and gives children no mutation identity', async () => {
    const source = consumedMemorySource(message);
    if (!source) throw new Error('Missing direct source');
    expect(source?.contentHash).toBe(createHash('sha256').update(message.text).digest('hex'));
    expect(JSON.stringify(source)).not.toContain('untrusted');
    for (const invalid of [
      { ...message, role: 'assistant' as const },
      { ...message, text: '' },
      { ...message, agentMessageId: 'child' },
    ])
      expect(consumedMemorySource(invalid)).toBeUndefined();
    const controller = new AbortController();
    let authority: RunMemoryMutationContext = {
      sessionId: 'session',
      branchId: 'branch',
      runId: 'run',
      signal: controller.signal,
    };
    let calls = 0;
    const port: RunMemoryPort = {
      ...base,
      saveMemory(ctx, value, id) {
        expect(this).toBe(port);
        calls += 1;
        expect(ctx.source).toEqual(source);
        expect(value).toEqual(input);
        expect(id).toBe('durable-id');
        return Promise.resolve(result);
      },
    };
    const handlers = memoryToolHandlers(
      port,
      () => ({ sessionId: 'session', workspaceId: null, query: '', signal: controller.signal }),
      () => authority,
    );
    if (!handlers.save) throw new Error('Missing executor');
    const invoke = { toolCallId: 'durable-id', signal: controller.signal };
    await expect(handlers.save(input, invoke)).rejects.toMatchObject({
      code: 'MEMORY_SOURCE_REQUIRED',
    });
    authority = { ...authority, source };
    await expect(handlers.save(input, invoke)).resolves.toEqual(result);
    await expect(handlers.save(input, invoke)).resolves.toEqual(result);
    controller.abort();
    await expect(handlers.save(input, invoke)).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(2);
  });

  it.each(['run', 'tool'] as const)(
    'passes one combined signal to the host and rejects a %s cancellation after an awaited operation',
    async (cancel) => {
      const run = new AbortController();
      const tool = new AbortController();
      const entered = agentGate();
      const release = agentGate();
      const source = consumedMemorySource(message);
      if (!source) throw new Error('Missing source');
      let hostSignal: AbortSignal | undefined;
      const handlers = memoryToolHandlers(
        {
          ...base,
          async saveMemory(context) {
            hostSignal = context.signal;
            entered.release();
            await release.promise;
            return result;
          },
        },
        () => ({ sessionId: 'session', workspaceId: null, query: '', signal: run.signal }),
        () => ({
          sessionId: 'session',
          branchId: 'branch',
          runId: 'run',
          source,
          signal: run.signal,
        }),
      );
      if (!handlers.save) throw new Error('Missing save');
      const pending = handlers.save(input, { toolCallId: 'durable-id', signal: tool.signal });
      try {
        await entered.promise;
        (cancel === 'run' ? run : tool).abort();
        expect(hostSignal?.aborted).toBe(true);
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        release.release();
        await rejected;
      } finally {
        release.release();
      }
    },
  );

  it.each(['ask', 'full-access'] as const)(
    'loads all five memory tools immediately and allows explicit save under %s without requesting approval',
    async (approvalMode) => {
      const calls: { context: RunMemoryMutationContext; id: string }[] = [];
      const f = await agentFixture({
        approvalMode,
        memory: {
          ...base,
          saveMemory: (context, value, id) => {
            calls.push({ context, id });
            expect(value).toEqual(input);
            return Promise.resolve(result);
          },
        },
        response: (context) => {
          expect(names(context)).toEqual(
            expect.arrayContaining([
              'search_memories',
              'save_memory',
              'learn_memory',
              'update_memory',
              'delete_memory',
            ]),
          );
          if (!hasResult(context, 'save_memory'))
            return call('save_memory', input, 'provider-save');
          return fauxAssistantMessage('Saved directly');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'Remember concise replies',
          mode: 'send',
          requestId: 'save',
        });
        await agentsIdle(f);
        expect(calls).toHaveLength(1);
        const source = f.runtime
          .getSnapshot(f.session.id)
          .messages.find((m) => m.text === 'Remember concise replies');
        expect(calls[0]?.context.source?.messageId).toBe(source?.id);
        expect(calls[0]?.id).not.toBe('provider-save');
        expect(
          f.store
            .readEvents(f.session.id)
            .some((event) => event.type === 'tool.approval_requested'),
        ).toBe(false);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(['steer', 'follow-up'] as const)(
    'uses actual consumed edited %s input and keeps a learning tool available after host settings change',
    async (mode) => {
      const entered = agentGate(),
        release = agentGate();
      let requests = 0,
        enabled = false;
      const sources: string[] = [];
      const f = await agentFixture({
        approvalMode: 'full-access',
        memory: {
          ...base,
          readSnapshot: () =>
            Promise.resolve({
              fingerprint: (enabled ? 'b' : 'a').repeat(64),
              entries: [],
              policy: { allowUse: true, allowLearning: enabled },
            }),
          isCurrent: (_input, expected) => expected === (enabled ? 'b' : 'a').repeat(64),
          learnMemory: (context) => {
            if (!enabled) throw new RuntimeError('MEMORY_LEARNING_DISABLED', 'Learning disabled');
            sources.push(context.source?.messageId ?? '');
            return Promise.resolve(result);
          },
        },
        response: async (context) => {
          expect(names(context)).toContain('learn_memory');
          requests += 1;
          const prompt = context.messages.find((message) => message.role === 'system');
          expect(JSON.stringify(prompt)).toContain(
            `use=on; learning=${requests === 1 ? 'off' : 'on'}`,
          );
          if (requests === 1) {
            entered.release();
            await release.promise;
            return fauxAssistantMessage('First answer');
          }
          if (!hasResult(context, 'learn_memory'))
            return call('learn_memory', input, 'learn-followup');
          return fauxAssistantMessage('Learned consumed input');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'Initial input',
          mode: 'send',
          requestId: 'initial',
        });
        await entered.promise;
        const queued = await f.runtime.send(f.session.id, {
          text: 'Pending preference',
          mode,
          requestId: 'queued',
        });
        if (!queued.inputId) throw new Error('Missing queue');
        await f.runtime.updateQueue(f.session.id, queued.inputId, {
          text: 'Edited stable preference',
          revision: 1,
        });
        expect(sources).toEqual([]);
        enabled = true;
        release.release();
        await agentsIdle(f);
        const consumed = f.runtime
          .getSnapshot(f.session.id)
          .messages.find((m) => m.text === 'Edited stable preference');
        expect(sources).toEqual([consumed?.id]);
        expect(f.errors).toEqual([]);
      } finally {
        release.release();
        await f.close();
      }
    },
  );

  it('does not inherit memory mutation tools or human provenance in delegated tasks', async () => {
    let saves = 0;
    const f = await agentFixture({
      approvalMode: 'full-access',
      memory: {
        ...base,
        saveMemory: () => {
          saves += 1;
          return Promise.resolve(result);
        },
      },
      response: (context) => {
        if (firstTask(context) === 'CHILD_READ_ONLY_MEMORY') {
          for (const name of ['save_memory', 'learn_memory', 'update_memory', 'delete_memory'])
            expect(names(context)).not.toContain(name);
          return fauxAssistantMessage('Child finished');
        }
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Child memory isolation', 'CHILD_READ_ONLY_MEMORY');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Root completed');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'Inspect memory in child',
        mode: 'send',
        requestId: 'child-memory',
      });
      await agentsIdle(f);
      expect(saves).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
