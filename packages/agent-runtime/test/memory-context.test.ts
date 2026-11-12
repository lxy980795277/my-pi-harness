import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import { decodeMemoryBlock } from '@my-pi-harness/memory/snapshot';
import { describe, expect, it } from 'vitest';
import { openProfileStore } from '@my-pi-harness/storage';
import { fixture, idle } from './support/work-fixture';
import { agentFixture, agentsIdle, firstTask } from './support/agent-fixture';
import { delegate, hasResult, waitForResults } from './support/agent-tools';

const remembered: MemoryRequestSnapshot = {
  fingerprint: 'c'.repeat(64),
  entries: [
    {
      id: 'preference',
      scope: { kind: 'user' },
      category: 'preference',
      body: '回答包含中文 emoji 🌕 和转义 "quote"。',
      revision: 1,
      source: { kind: 'manual' },
    },
  ],
};

describe('fixed memory in actual Pi requests and journals', () => {
  it('records the exact adopted prompt once, counts memory separately and rebuilds adoption after facts change', async () => {
    let current = remembered;
    const requests: TranscriptContext[] = [];
    const f = await fixture(false, {
      memory: {
        readSnapshot: () => Promise.resolve(current),
        isCurrent: (_input, fingerprint) => fingerprint === current.fingerprint,
      },
    });
    try {
      f.faux.setResponses([
        (context) => {
          requests.push(context);
          return fauxAssistantMessage('answer');
        },
      ]);
      const accepted = await f.runtime.send(f.session.id, {
        text: '请回答',
        mode: 'send',
        requestId: 'memory',
      });
      if (!accepted.runId) throw new Error('Missing memory Run');
      await idle(f);
      const usage = f.store.getMemoryUsage(f.session.id, accepted.runId);
      expect(usage?.entries).toEqual(remembered.entries);
      expect(f.work.snapshot(f.session.id).state.usage?.categories.memory).toBeGreaterThan(0);
      expect(JSON.stringify(requests[0]?.messages)).toContain('preference');
      const events = f.store.readEvents(f.session.id, 0, 1000);
      const prepared = events.find(({ type }) => type === 'context.prepared');
      expect(prepared).toBeDefined();
      expect(events.find(({ seq }) => seq === (prepared?.seq ?? 0) - 1)?.type).toBe('work.updated');
      current = { fingerprint: 'd'.repeat(64), entries: [] };
      expect(
        f.runtime.getSnapshot(f.session.id).messages.some(({ text }) => text.includes('emoji')),
      ).toBe(false);
      await f.runtime.close();
      f.store.close();
      const restored = await openProfileStore(f.profile);
      try {
        expect(restored.getMemoryUsage(f.session.id, accepted.runId)?.entries).toEqual(
          remembered.entries,
        );
      } finally {
        restored.close();
      }
    } finally {
      await f.close();
    }
  });

  it('does not send or record silently truncated fixed facts above the memory allocation', async () => {
    const excessive = {
      ...remembered,
      entries: remembered.entries.map((entry) => ({ ...entry, body: 'x'.repeat(16000) })),
    };
    const f = await fixture(false, {
      memory: { readSnapshot: () => Promise.resolve(excessive), isCurrent: () => true },
    });
    try {
      f.faux.setResponses([fauxAssistantMessage('must not run')]);
      const accepted = await f.runtime.send(f.session.id, {
        text: '请回答',
        mode: 'send',
        requestId: 'too-large',
      });
      if (!accepted.runId) throw new Error('Missing memory Run');
      await idle(f);
      const failed = f.runtime.getSnapshot(f.session.id).runs.at(-1);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toContain('preference');
      expect(f.store.getMemoryUsage(f.session.id, accepted.runId)).toBeNull();
    } finally {
      await f.close();
    }
  });

  it('passes actual child identity to the host and keeps user memory out of the child prompt', async () => {
    const workspace = {
      ...remembered,
      fingerprint: 'e'.repeat(64),
      entries: remembered.entries.map((entry) => ({
        ...entry,
        id: 'workspace-fact',
        scope: { kind: 'workspace' as const, workspaceId: 'workspace' },
        body: 'workspace reference',
      })),
    };
    const seen: (string | undefined)[] = [];
    const f = await agentFixture({
      workspace: true,
      settings: (settings) => ({
        ...settings,
        limits: { ...settings.limits, maxConcurrentRequests: 1 },
      }),
      memory: {
        readSnapshot: ({ taskId }) => {
          seen.push(taskId);
          return Promise.resolve(taskId ? workspace : remembered);
        },
        isCurrent: ({ taskId }, fingerprint) =>
          fingerprint === (taskId ? workspace : remembered).fingerprint,
      },
      response: (context) => {
        const prompt = JSON.stringify(context.messages.filter(({ role }) => role === 'system'));
        if (firstTask(context) === 'MEMORY_CHILD') {
          expect(prompt).toContain('workspace-fact');
          expect(prompt).not.toContain('回答包含中文');
          return fauxAssistantMessage('child result');
        }
        expect(prompt).toContain('preference');
        if (!hasResult(context, 'spawn_agent')) return delegate('Memory child', 'MEMORY_CHILD');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('root result');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'MEMORY_ROOT',
        mode: 'send',
        requestId: 'scoped-memory',
      });
      await agentsIdle(f);
      const task = f.runtime.subagents.list(f.session.id).tasks[0];
      if (!task?.latestRunId) throw new Error('Missing child memory Run');
      expect(seen).toContain(task.id);
      expect(f.store.getMemoryUsage(f.session.id, task.latestRunId)?.entries).toEqual(
        workspace.entries,
      );
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each([true, false])(
    'audits the final budgeted entries and explanation with context=%s',
    async (context) => {
      const original = remembered.entries[0];
      if (!original) throw new Error('Missing fixed fixture');
      const fixed = { ...original, id: 'exact-fixed', mode: 'fixed' as const };
      const related = {
        ...fixed,
        id: 'large-related',
        mode: 'relevant' as const,
        body: 'Related detail '.repeat(1000),
      };
      const snapshot: MemoryRequestSnapshot = {
        fingerprint: 'f'.repeat(64),
        entries: [related, fixed],
        selection: {
          retrieval: 'hybrid',
          candidateCount: 1,
          matchedCount: 1,
          omittedCount: 0,
          omissions: [],
        },
      };
      const f = await fixture(false, {
        context,
        memory: { readSnapshot: () => Promise.resolve(snapshot), isCurrent: () => true },
      });
      try {
        let prompt = '';
        f.faux.setResponses([
          (request) => {
            prompt = JSON.stringify(request.messages.filter(({ role }) => role === 'system'));
            return fauxAssistantMessage('budgeted answer');
          },
        ]);
        const accepted = await f.runtime.send(f.session.id, {
          text: 'Apply current memory',
          mode: 'send',
          requestId: 'budget-final',
        });
        if (!accepted.runId) throw new Error('Missing memory Run');
        await idle(f);
        expect(prompt).toContain('exact-fixed');
        expect(prompt).not.toContain('large-related');
        expect(prompt).not.toContain('omissions');
        const usage = f.store.getMemoryUsage(f.session.id, accepted.runId);
        expect(usage?.entries).toEqual([fixed]);
        expect(usage?.selection).toMatchObject({
          matchedCount: 1,
          omittedCount: 1,
          omissions: [{ id: 'large-related', reason: 'budget' }],
        });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('keeps zero-match explanation in private adoption metadata without a model-visible empty block', async () => {
    const snapshot: MemoryRequestSnapshot = {
      fingerprint: 'f'.repeat(64),
      entries: [],
      selection: {
        retrieval: 'lexical',
        candidateCount: 1,
        matchedCount: 0,
        omittedCount: 1,
        omissions: [
          { id: 'not-adopted', revision: 1, mode: 'relevant', reason: 'below-threshold' },
        ],
      },
    };
    const f = await fixture(false, {
      memory: { readSnapshot: () => Promise.resolve(snapshot), isCurrent: () => true },
    });
    try {
      let prompt = '';
      f.faux.setResponses([
        (request) => {
          prompt = JSON.stringify(request.messages);
          return fauxAssistantMessage('no adopted memory');
        },
      ]);
      const accepted = await f.runtime.send(f.session.id, {
        text: 'An unrelated question',
        mode: 'send',
        requestId: 'zero-adoption',
      });
      if (!accepted.runId) throw new Error('Missing memory Run');
      await idle(f);
      expect(prompt).not.toContain('not-adopted');
      expect(prompt).not.toContain(snapshot.fingerprint);
      expect(f.store.getMemoryUsage(f.session.id, accepted.runId)).toMatchObject({
        entries: [],
        selection: snapshot.selection,
      });
      expect(f.work.snapshot(f.session.id).state.usage?.categories.memory).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('keeps UTF-16 audit ranges exact after quoted text and supplementary Unicode', () => {
    const encoded = JSON.stringify(remembered);
    const prefix = '低信任资料 🪐\n';
    const text = prefix + encoded;
    expect(decodeMemoryBlock(text, { start: prefix.length, end: text.length })).toEqual(remembered);
    expect(() => decodeMemoryBlock(text, { start: 1, end: text.length + 1 })).toThrow();
  });
});
