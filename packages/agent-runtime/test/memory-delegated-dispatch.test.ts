import { createHash } from 'node:crypto';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { MemoryAdoptedEntry } from '@my-pi-harness/protocol';
import type { RunMemoryPort, RunMemoryRequest } from '../src/runs/ports';
import { describe, expect, it } from 'vitest';
import {
  agentFixture,
  agentGate,
  agentsIdle,
  firstTask,
  waitAtGate,
} from './support/agent-fixture';
import { hasResult, waitForResults } from './support/agent-tools';
import { withinDeadline } from './support/work-fixture';

const original: MemoryAdoptedEntry = {
  id: 'shared',
  mode: 'relevant',
  scope: { kind: 'user' },
  category: 'fact',
  body: 'OLD_SHARED_REFERENCE',
  revision: 1,
  source: { kind: 'manual' },
};

describe('delegated memory revalidation at actual model admission', () => {
  it.each(['forget', 'disable-use', 'edit'] as const)(
    'refreshes a waiting child after %s without resending a handed-off request',
    async (change) => {
      const holding = agentGate();
      const targetPrepared = agentGate();
      const release = agentGate();
      let enabled = true;
      let fact: MemoryAdoptedEntry | undefined = original;
      let targetReads = 0;
      let targetRequests = 0;
      const selected = (input: RunMemoryRequest): MemoryAdoptedEntry[] =>
        enabled && fact && (!input.taskId || input.userMemoryIds?.includes(fact.id)) ? [fact] : [];
      const fingerprint = (input: RunMemoryRequest) =>
        createHash('sha256')
          .update(JSON.stringify([enabled, selected(input)]))
          .digest('hex');
      const memory: RunMemoryPort = {
        async readSnapshot(input) {
          const snapshot = { fingerprint: fingerprint(input), entries: selected(input) };
          if (input.query === 'TARGET_MEMORY' && input.taskId) {
            targetReads += 1;
            if (targetReads === 1) {
              await waitAtGate(holding, input.signal);
              targetPrepared.release();
            }
          }
          return snapshot;
        },
        isCurrent: (input, expected) => expected === fingerprint(input),
        canUse: () => enabled,
        validateDelegation: (_input, ids) => [...ids],
      };
      const f = await agentFixture({
        memory,
        settings: (settings) => ({
          ...settings,
          limits: { ...settings.limits, maxConcurrentRequests: 1 },
        }),
        beforeStream: async (context, signal) => {
          if (firstTask(context) === 'HOLD_MEMORY') {
            holding.release();
            await waitAtGate(release, signal);
          }
        },
        response: (context) => {
          if (firstTask(context) === 'HOLD_MEMORY')
            return fauxAssistantMessage('Holding child finished');
          if (firstTask(context) === 'TARGET_MEMORY') {
            targetRequests += 1;
            const prompt = JSON.stringify(context.messages.filter(({ role }) => role === 'system'));
            expect(prompt).not.toContain('OLD_SHARED_REFERENCE');
            if (change === 'edit') expect(prompt).toContain('NEW_SHARED_REFERENCE');
            return fauxAssistantMessage('Target finished with current memory');
          }
          if (!hasResult(context, 'spawn_agent'))
            return fauxAssistantMessage(
              [
                {
                  type: 'toolCall',
                  id: 'hold-memory',
                  name: 'spawn_agent',
                  arguments: {
                    title: 'Holding',
                    task: 'HOLD_MEMORY',
                    roleId: 'researcher',
                    userMemoryIds: ['shared'],
                  },
                },
                {
                  type: 'toolCall',
                  id: 'target-memory',
                  name: 'spawn_agent',
                  arguments: {
                    title: 'Target',
                    task: 'TARGET_MEMORY',
                    roleId: 'researcher',
                    userMemoryIds: ['shared'],
                  },
                },
              ],
              { stopReason: 'toolUse' },
            );
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Root collected both children');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_DELEGATED_MEMORY',
          mode: 'send',
          requestId: change,
        });
        await withinDeadline(
          Promise.all([holding.promise, targetPrepared.promise]),
          'The child did not prepare while another request owned the only slot',
        );
        if (change === 'forget') fact = undefined;
        else if (change === 'disable-use') enabled = false;
        else fact = { ...original, revision: 2, body: 'NEW_SHARED_REFERENCE' };
        release.release();
        await agentsIdle(f);
        expect(targetReads).toBe(2);
        expect(targetRequests).toBe(1);
        const target = f.runtime.subagents
          .list(f.session.id)
          .tasks.find(({ title }) => title === 'Target');
        if (!target?.latestRunId) throw new Error('Missing target task');
        expect(
          f.store
            .readEvents(f.session.id)
            .filter(
              (event) => event.type === 'context.prepared' && event.runId === target.latestRunId,
            ),
        ).toHaveLength(1);
        expect(f.store.getMemoryUsage(f.session.id, target.latestRunId)?.entries).toEqual(
          change === 'edit' ? [fact] : [],
        );
        expect(f.errors).toEqual([]);
      } finally {
        release.release();
        holding.release();
        await f.close();
      }
    },
  );
});
