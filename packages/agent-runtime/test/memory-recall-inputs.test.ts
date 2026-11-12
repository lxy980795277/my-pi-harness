import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import { describe, expect, it } from 'vitest';
import { fixture, idle } from './support/work-fixture';
import { agentFixture, agentGate, agentsIdle, firstTask } from './support/agent-fixture';
import { call } from './support/work-fixture';
import { delegate, hasResult, waitForResults } from './support/agent-tools';

const empty: MemoryRequestSnapshot = { fingerprint: 'a'.repeat(64), entries: [] };

describe('memory recall follows actual input consumption', () => {
  it.each(['steer', 'follow-up'] as const)(
    'uses the edited consumed %s input instead of the first question or pending text',
    async (mode) => {
      const seen: string[] = [];
      const entered = agentGate();
      const release = agentGate();
      const f = await fixture(false, {
        memory: {
          readSnapshot: (input) => {
            seen.push(input.query);
            return Promise.resolve(empty);
          },
          isCurrent: () => true,
        },
      });
      try {
        f.faux.setResponses([
          async () => {
            entered.release();
            await release.promise;
            return fauxAssistantMessage('first');
          },
          fauxAssistantMessage('second'),
        ]);
        await f.runtime.send(f.session.id, {
          text: 'First actual question',
          mode: 'send',
          requestId: 'initial',
        });
        await entered.promise;
        const queued = await f.runtime.send(f.session.id, {
          text: 'Pending original query',
          mode,
          requestId: 'queued',
        });
        if (!queued.inputId) throw new Error('Missing queued memory input');
        await f.runtime.updateQueue(f.session.id, queued.inputId, {
          text: 'Edited consumed query',
          revision: 1,
        });
        expect(seen).toEqual(['First actual question']);
        release.release();
        await idle(f);
        expect(seen).toEqual(['First actual question', 'Edited consumed query']);
        expect(f.errors).toEqual([]);
      } finally {
        release.release();
        await f.close();
      }
    },
  );

  it('does not replace the root human recall query with an agent-to-agent statement', async () => {
    const seen: { taskId?: string; query: string }[] = [];
    const f = await agentFixture({
      memory: {
        readSnapshot: (input) => {
          seen.push({ query: input.query, ...(input.taskId ? { taskId: input.taskId } : {}) });
          return Promise.resolve(empty);
        },
        isCurrent: () => true,
      },
      response: (context) => {
        if (firstTask(context) === 'QUERY_CHILD') {
          if (!hasResult(context, 'send_agent_message'))
            return call(
              'send_agent_message',
              {
                target: { kind: 'parent' },
                text: 'I am an agent; this is not a human preference.',
              },
              'query-message',
            );
          return fauxAssistantMessage('child result');
        }
        if (!hasResult(context, 'spawn_agent')) return delegate('Query child', 'QUERY_CHILD');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('root result');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'Actual human recall query',
        mode: 'send',
        requestId: 'communication-query',
      });
      await agentsIdle(f);
      expect(
        seen
          .filter((input) => !input.taskId)
          .every(({ query }) => query === 'Actual human recall query'),
      ).toBe(true);
      expect(
        seen.filter((input) => input.taskId).every(({ query }) => query === 'QUERY_CHILD'),
      ).toBe(true);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
