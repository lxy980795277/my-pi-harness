import { createHash } from 'node:crypto';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { MemoryAdoptedEntry } from '@my-pi-harness/protocol';
import type { RunMemoryPort, RunMemoryRequest } from '../src/runs/ports';
import { RuntimeError } from '../src/errors';
import { describe, expect, it } from 'vitest';
import { agentFixture, agentGate, agentsIdle, firstTask } from './support/agent-fixture';
import { call } from './support/work-fixture';
import { hasResult, resultCount, waitForResults } from './support/agent-tools';

const user: MemoryAdoptedEntry = {
  id: 'user-reference',
  mode: 'fixed',
  scope: { kind: 'user' },
  category: 'fact',
  body: 'AUTHORIZED_USER_REFERENCE',
  revision: 1,
  source: { kind: 'manual' },
};
const other: MemoryAdoptedEntry = {
  ...user,
  id: 'other-user-reference',
  body: 'OTHER_USER_REFERENCE',
};
const workspace: MemoryAdoptedEntry = {
  ...user,
  id: 'workspace-reference',
  scope: { kind: 'workspace', workspaceId: 'workspace' },
  body: 'WORKSPACE_REFERENCE',
};

function system(context: TranscriptContext): string {
  return JSON.stringify(context.messages.filter(({ role }) => role === 'system'));
}

function entries(input: RunMemoryRequest): MemoryAdoptedEntry[] {
  const personal = input.taskId
    ? [user, other].filter((entry) => input.userMemoryIds?.includes(entry.id))
    : [user, other];
  return [...personal, ...(input.workspaceId === 'workspace' ? [workspace] : [])];
}

function fingerprint(input: RunMemoryRequest): string {
  return createHash('sha256')
    .update(JSON.stringify(entries(input).map(({ id, revision }) => [id, revision])))
    .digest('hex');
}

describe('scoped memory tools through real Pi task Runs', () => {
  it('forwards exact user IDs to one child without exposing them to a sibling or expanding them in a nested task', async () => {
    let rejectedExpansion = false;
    const memory: RunMemoryPort = {
      readSnapshot: (input) =>
        Promise.resolve({ fingerprint: fingerprint(input), entries: entries(input) }),
      isCurrent: (input, expected) => expected === fingerprint(input),
      canUse: () => true,
      searchMemories: (input) =>
        Promise.resolve({ entries: entries(input), mode: 'lexical', truncated: false }),
      validateDelegation(input, ids) {
        const allowed = new Set(
          entries(input)
            .filter((entry) => entry.scope.kind === 'user')
            .map(({ id }) => id),
        );
        if (ids.some((id) => !allowed.has(id)))
          throw new RuntimeError('MEMORY_SCOPE', '只能转交当前执行可读的用户记忆。');
        return [...ids];
      },
    };
    const f = await agentFixture({
      workspace: true,
      memory,
      settings: (settings) => ({
        ...settings,
        limits: { ...settings.limits, maxConcurrentRequests: 1 },
      }),
      response: (context) => {
        const prompt = system(context);
        if (firstTask(context) === 'CHILD_WITH_REFERENCE') {
          expect(prompt).toContain('AUTHORIZED_USER_REFERENCE');
          expect(prompt).not.toContain('OTHER_USER_REFERENCE');
          expect(prompt).toContain('WORKSPACE_REFERENCE');
          if (!hasResult(context, 'spawn_agent'))
            return call(
              'spawn_agent',
              {
                title: 'Forbidden expansion',
                roleId: 'researcher',
                task: 'MUST_NOT_START',
                userMemoryIds: ['other-user-reference'],
              },
              'forbidden-memory',
            );
          rejectedExpansion = context.messages.some(
            (message) =>
              message.role === 'toolResult' &&
              message.toolName === 'spawn_agent' &&
              message.isError,
          );
          return fauxAssistantMessage('Scoped child finished');
        }
        if (firstTask(context) === 'CHILD_WITHOUT_REFERENCE') {
          expect(prompt).not.toContain('AUTHORIZED_USER_REFERENCE');
          expect(prompt).not.toContain('OTHER_USER_REFERENCE');
          expect(prompt).toContain('WORKSPACE_REFERENCE');
          return fauxAssistantMessage('Sibling finished');
        }
        const count = resultCount(context, 'spawn_agent');
        if (count === 0)
          return call(
            'spawn_agent',
            {
              title: 'Explicit reference',
              task: 'CHILD_WITH_REFERENCE',
              roleId: 'researcher',
              userMemoryIds: ['user-reference'],
            },
            'share-reference',
          );
        if (count === 1)
          return call(
            'spawn_agent',
            { title: 'No reference', task: 'CHILD_WITHOUT_REFERENCE', roleId: 'researcher' },
            'no-reference',
          );
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Root collected scoped results');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_MEMORY_SCOPE',
        mode: 'send',
        requestId: 'scoped-delegation',
      });
      await agentsIdle(f);
      const tasks = f.runtime.subagents.list(f.session.id).tasks;
      expect(tasks).toHaveLength(2);
      expect(tasks.find(({ title }) => title === 'Explicit reference')?.userMemoryIds).toEqual([
        'user-reference',
      ]);
      expect(tasks.find(({ title }) => title === 'No reference')?.userMemoryIds).toBeUndefined();
      expect(rejectedExpansion).toBe(true);
      expect(tasks.every(({ status }) => status === 'completed')).toBe(true);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('provides memory search immediately and refuses a result after memory use is disabled during the search', async () => {
    const entered = agentGate();
    const release = agentGate();
    let enabled = true;
    let rejected = false;
    const f = await agentFixture({
      memory: {
        readSnapshot: () => Promise.resolve({ fingerprint: 'a'.repeat(64), entries: [] }),
        isCurrent: () => true,
        canUse: () => enabled,
        searchMemories: async (_identity, query) => {
          expect(query).toBe('exact memory query');
          entered.release();
          await release.promise;
          return { entries: [user], mode: 'lexical', truncated: false };
        },
      },
      response: (context) => {
        expect(
          context.messages.flatMap((message) =>
            message.role === 'system' ? (message.toolsAdded?.map(({ name }) => name) ?? []) : [],
          ),
        ).toContain('search_memories');
        if (!hasResult(context, 'search_memories'))
          return call(
            'search_memories',
            { query: 'exact memory query', limit: 3 },
            'memory-search',
          );
        const result = context.messages.find(
          (message) => message.role === 'toolResult' && message.toolName === 'search_memories',
        );
        rejected = result?.role === 'toolResult' && result.isError;
        expect(JSON.stringify(result)).not.toContain('AUTHORIZED_USER_REFERENCE');
        return fauxAssistantMessage('Memory permissions changed');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'Search authorized memories',
        mode: 'send',
        requestId: 'search-memory',
      });
      await entered.promise;
      enabled = false;
      release.release();
      await agentsIdle(f);
      expect(rejected).toBe(true);
      expect(
        f.store
          .readEvents(f.session.id)
          .some(
            (event) =>
              event.type === 'run.tools_loaded' &&
              JSON.stringify(event.data).includes('search_memories'),
          ),
      ).toBe(false);
      expect(f.errors).toEqual([]);
    } finally {
      release.release();
      await f.close();
    }
  });
});
