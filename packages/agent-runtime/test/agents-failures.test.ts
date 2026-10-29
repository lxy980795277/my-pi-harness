import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { setImmediate as nextImmediate } from 'node:timers/promises';
import { StorageError } from '@my-pi-harness/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  agentChanged,
  agentFixture,
  agentGate,
  agentsIdle,
  firstTask,
  waitAtGate,
} from './support/agent-fixture.js';
import { delegate, hasResult, resultCount, waitForResults } from './support/agent-tools.js';
import { call, withinDeadline } from './support/work-fixture.js';

function containsFailure(error: unknown, expected: Error): boolean {
  if (error === expected) return true;
  if (error instanceof AggregateError)
    return error.errors.some((failure: unknown) => containsFailure(failure, expected));
  return error instanceof Error && containsFailure(error.cause, expected);
}

describe('Agent failure ownership through real Pi and temporary journals', () => {
  it.each([false, true])(
    'preserves a preparation timeout when the resolver wraps abort (later stop=%s)',
    async (laterStop) => {
      const preparation = agentGate();
      const timedOut = agentGate();
      const cleanup = agentGate();
      const f = await agentFixture({
        beforeResolve: async (index, signal) => {
          if (index !== 2) return;
          preparation.release();
          try {
            await waitAtGate(agentGate(), signal);
          } catch {
            timedOut.release();
            await cleanup.promise;
            throw new DOMException('Resolver cancelled during cleanup', 'AbortError');
          }
        },
        response: (context) => {
          if (!hasResult(context, 'spawn_agent'))
            return call(
              'spawn_agent',
              {
                title: 'Preparation deadline',
                task: 'PREPARATION_TIMEOUT',
                roleId: 'researcher',
                limits: { timeoutMs: 1000 },
              },
              'preparation-timeout',
            );
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Parent collected the preparation failure');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_PREPARATION_TIMEOUT',
          mode: 'send',
          requestId: `preparation-timeout-${String(laterStop)}`,
        });
        await withinDeadline(preparation.promise, 'Child preparation never started');
        await withinDeadline(timedOut.promise, 'Child preparation deadline did not abort');
        const task = f.runtime.agents.list(f.session.id).tasks[0];
        if (!task) throw new Error('Missing preparing task');
        const stopping = laterStop
          ? f.runtime.agents.stop(f.session.id, task.id, { expectedRunId: null })
          : undefined;
        cleanup.release();
        if (stopping) await withinDeadline(stopping, 'Late stop did not settle preparation');
        await agentsIdle(f);
        expect(f.runtime.agents.list(f.session.id).tasks[0]).toMatchObject({
          status: 'failed',
          closeReason: 'failed',
          error: '子任务已达到执行时限。',
          latestRunId: null,
        });
        expect(f.store.getTaskSnapshot(f.session.id, task.id).runs).toEqual([]);
        expect(f.requests.some((request) => request.task === 'PREPARATION_TIMEOUT')).toBe(false);
        expect(f.leases()).toEqual({ acquired: 1, released: 1 });
      } finally {
        cleanup.release();
        await f.close();
      }
    },
  );

  it.each([
    {
      limits: { tokenBudget: 1024 },
      reason: '任务树的剩余 token 预算不足以发起下一次请求。',
    },
    { limits: { maxTurns: 1 }, reason: '任务已达到模型请求轮数上限。' },
  ])(
    'records the exact admission failure $reason on its failed Run',
    async ({ limits, reason }) => {
      const f = await agentFixture({
        settings: (settings) => ({ ...settings, limits: { ...settings.limits, ...limits } }),
        response: (context) => {
          if (firstTask(context) === 'LIMITED_CHILD') return fauxAssistantMessage('Child result');
          if (!hasResult(context, 'spawn_agent')) return delegate('Bounded child', 'LIMITED_CHILD');
          return fauxAssistantMessage('A denied parent request must not reach this provider');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_ADMISSION_FAILURE',
          mode: 'send',
          requestId: 'admission-failure',
        });
        await agentsIdle(f);
        expect(f.runtime.getSnapshot(f.session.id).runs[0]).toMatchObject({
          status: 'failed',
          error: reason,
        });
        expect(
          f.requests.filter((request) => request.task === 'ROOT_ADMISSION_FAILURE'),
        ).toHaveLength(1);
      } finally {
        await f.close();
      }
    },
  );

  it.each([false, true])(
    'preserves the last allowed child turn outcome (timeout=%s)',
    async (timeout) => {
      const f = await agentFixture({
        response: (context) => {
          if (firstTask(context) === 'ONE_TURN_CHILD') {
            if (timeout)
              return fauxAssistantMessage('', {
                stopReason: 'error',
                errorMessage: 'Request timed out.',
              });
            return fauxAssistantMessage('Verified in one request');
          }
          if (!hasResult(context, 'spawn_agent'))
            return call(
              'spawn_agent',
              {
                title: 'One-turn check',
                task: 'ONE_TURN_CHILD',
                roleId: 'researcher',
                limits: { maxTurns: 1 },
              },
              'one-turn',
            );
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Parent collected the child outcome');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_ONE_TURN',
          mode: 'send',
          requestId: 'one-turn',
        });
        await agentsIdle(f);
        const task = f.runtime.agents.list(f.session.id).tasks[0];
        if (!task) throw new Error('Missing one-turn task');
        const status = timeout ? 'failed' : 'completed';
        expect(task.status).toBe(status);
        expect(f.store.getTaskSnapshot(f.session.id, task.id).runs[0]).toMatchObject({
          status,
          error: timeout ? '模型请求超时，请稍后重试。' : null,
        });
        expect(f.requests.filter((request) => request.task === 'ONE_TURN_CHILD')).toHaveLength(1);
        expect(
          f.runtime.getSnapshot(f.session.id).tools.find((tool) => tool.name === 'wait_agents')
            ?.result,
        ).toContain(timeout ? '模型请求超时，请稍后重试。' : 'Verified in one request');
        expect(f.leases()).toEqual({ acquired: 2, released: 2 });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(['sdk-tools', 'queue-read'] as const)(
    'settles an accepted child when %s initialization fails',
    async (stage) => {
      const f = await agentFixture({
        response: (context) => {
          if (firstTask(context) === 'INIT_FAILURE_CHILD')
            return fauxAssistantMessage('This child should never request a model');
          if (!hasResult(context, 'spawn_agent'))
            return delegate('Initialization failure', 'INIT_FAILURE_CHILD');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Parent handled child initialization failure');
        },
      });
      const failure = new Error(`Controlled ${stage} failure`);
      let injected = false;
      const createTools = f.tools.createTools.bind(f.tools);
      const readMessages = f.store.listAgentMessages.bind(f.store);
      const toolsSpy = vi.spyOn(f.tools, 'createTools');
      const queueSpy = vi.spyOn(f.store, 'listAgentMessages');
      toolsSpy.mockImplementation((context, toolset) => {
        if (stage === 'sdk-tools' && context.run.taskId !== undefined) {
          injected = true;
          throw failure;
        }
        return createTools(context, toolset);
      });
      queueSpy.mockImplementation((sessionId, target) => {
        if (stage === 'queue-read' && !injected && target?.kind === 'task') {
          const runId = f.store.getAgentTask(sessionId, target.taskId)?.latestRunId;
          if (runId !== null && runId !== undefined) {
            injected = true;
            throw failure;
          }
        }
        return readMessages(sessionId, target);
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_INIT_FAILURE',
          mode: 'send',
          requestId: stage,
        });
        await agentsIdle(f);
        const task = f.runtime.agents.list(f.session.id).tasks[0];
        if (!task) throw new Error('Missing failed task');
        expect(injected).toBe(true);
        expect(task.status).toBe('failed');
        expect(task.closedAt).not.toBeNull();
        const childRuns = f.store.getTaskSnapshot(f.session.id, task.id).runs;
        expect(childRuns).toHaveLength(1);
        expect(childRuns[0]?.status).toBe('failed');
        expect(childRuns[0]?.finishedAt).not.toBeNull();
        expect(f.runtime.getSnapshot(f.session.id).session.activeRunId).toBeNull();
        expect(f.requests.some((request) => request.task === 'INIT_FAILURE_CHILD')).toBe(false);
        expect(f.leases()).toEqual({ acquired: 2, released: 2 });
        expect(f.errors).toContain(failure);
      } finally {
        toolsSpy.mockRestore();
        queueSpy.mockRestore();
        await f.close();
      }
    },
  );

  it('cancels a blocked child when the parent SDK returns a failed final message', async () => {
    const entered = agentGate();
    const blocked = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        if (firstTask(context) !== 'PARENT_FAILURE_CHILD') return;
        entered.release();
        await waitAtGate(blocked, signal);
      },
      response: async (context) => {
        if (firstTask(context) === 'PARENT_FAILURE_CHILD')
          return fauxAssistantMessage('Must be cancelled');
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Blocked child', 'PARENT_FAILURE_CHILD');
        await entered.promise;
        return fauxAssistantMessage('', {
          stopReason: 'error',
          errorMessage: 'Controlled provider failure',
        });
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_PROVIDER_FAILURE',
        mode: 'send',
        requestId: 'parent-failed',
      });
      await withinDeadline(entered.promise, 'Child never entered its model request');
      await agentsIdle(f);
      const task = f.runtime.agents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing cancelled child');
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('failed');
      expect(task.status).toBe('cancelled');
      expect(f.store.getTaskSnapshot(f.session.id, task.id).runs[0]?.status).toBe('cancelled');
      expect(f.leases()).toEqual({ acquired: 2, released: 2 });
    } finally {
      blocked.release();
      await f.close();
    }
  });

  it('rejects a newly disabled role while preserving an already accepted task selection', async () => {
    const childEntered = agentGate();
    const releaseChild = agentGate();
    const parentEntered = agentGate();
    const releaseParent = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        if (firstTask(context) === 'OLD_ROLE_CHILD') {
          childEntered.release();
          await waitAtGate(releaseChild, signal);
        } else if (hasResult(context, 'spawn_agent')) {
          parentEntered.release();
          await waitAtGate(releaseParent, signal);
        }
      },
      response: (context) => {
        if (firstTask(context) === 'OLD_ROLE_CHILD')
          return fauxAssistantMessage('Accepted role stayed frozen');
        if (resultCount(context, 'spawn_agent') === 0)
          return delegate('Accepted before disable', 'OLD_ROLE_CHILD', 'first');
        if (resultCount(context, 'spawn_agent') === 1)
          return delegate('Rejected after disable', 'NEW_DISABLED_ROLE_CHILD', 'second');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Existing work finished after role disable');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_ROLE_CHANGE',
        mode: 'send',
        requestId: 'role-change',
      });
      await withinDeadline(
        Promise.all([childEntered.promise, parentEntered.promise]),
        'Role-change barriers were not reached',
      );
      const accepted = f.runtime.agents.list(f.session.id).tasks[0];
      if (!accepted) throw new Error('Missing accepted role task');
      const settings = f.runtime.agents.settings();
      f.runtime.agents.updateSettings({
        ...settings,
        roles: settings.roles.map((role) =>
          role.id === 'researcher'
            ? { ...role, enabled: false, instructions: 'CHANGED_ROLE_INSTRUCTIONS' }
            : role,
        ),
      });
      releaseParent.release();
      await agentChanged(
        f,
        () =>
          f.runtime
            .getSnapshot(f.session.id)
            .tools.some(
              (tool) =>
                tool.name === 'spawn_agent' &&
                tool.arguments['title'] === 'Rejected after disable' &&
                tool.status === 'failed',
            ),
        'Disabled role was not rejected',
      );
      expect(f.runtime.agents.list(f.session.id).tasks).toHaveLength(1);
      expect(f.store.getAgentTask(f.session.id, accepted.id)?.role.instructions).toBe(
        accepted.role.instructions,
      );
      releaseChild.release();
      await agentsIdle(f);
      expect(f.requests.find((request) => request.task === 'OLD_ROLE_CHILD')?.json).toContain(
        accepted.role.instructions,
      );
      expect(f.requests.find((request) => request.task === 'OLD_ROLE_CHILD')?.json).not.toContain(
        'CHANGED_ROLE_INSTRUCTIONS',
      );
      expect(f.requests.some((request) => request.task === 'NEW_DISABLED_ROLE_CHILD')).toBe(false);
      expect(f.runtime.agents.list(f.session.id).tasks[0]?.status).toBe('completed');
    } finally {
      releaseParent.release();
      releaseChild.release();
      await f.close();
    }
  });

  it('stops the full tree on a journal failure and waits for a sibling resource to really settle', async () => {
    const failureReady = agentGate();
    const releaseFailure = agentGate();
    const siblingReady = agentGate();
    const siblingAborted = agentGate();
    const settleSibling = agentGate();
    const failed = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        const task = firstTask(context);
        if (task === 'JOURNAL_FAILURE_CHILD') {
          failureReady.release();
          await waitAtGate(releaseFailure, signal);
        } else if (task === 'SLOW_CLEANUP_CHILD') {
          siblingReady.release();
          if (!signal) throw new Error('Sibling model request needs its owned signal');
          const abort = (): void => {
            siblingAborted.release();
          };
          signal.addEventListener('abort', abort, { once: true });
          try {
            if (signal.aborted) abort();
            // This controlled provider acknowledges cancellation before its lease can be released.
            await settleSibling.promise;
          } finally {
            signal.removeEventListener('abort', abort);
          }
        }
      },
      response: (context) => {
        const task = firstTask(context);
        if (task === 'JOURNAL_FAILURE_CHILD')
          return fauxAssistantMessage('Trigger terminal journal write');
        if (task === 'SLOW_CLEANUP_CHILD')
          return fauxAssistantMessage('Should not finish after abort');
        if (!hasResult(context, 'spawn_agent'))
          return fauxAssistantMessage(
            [
              {
                type: 'toolCall',
                id: 'fail-child',
                name: 'spawn_agent',
                arguments: {
                  title: 'Journal failure',
                  task: 'JOURNAL_FAILURE_CHILD',
                  roleId: 'researcher',
                },
              },
              {
                type: 'toolCall',
                id: 'slow-cleanup',
                name: 'spawn_agent',
                arguments: {
                  title: 'Slow cleanup',
                  task: 'SLOW_CLEANUP_CHILD',
                  roleId: 'researcher',
                },
              },
            ],
            { stopReason: 'toolUse' },
          );
        return waitForResults(context);
      },
    });
    const originalAppend = f.store.append.bind(f.store);
    const failure = new StorageError('SESSION_LOG_UNAVAILABLE', 'Controlled journal write failure');
    let faultRunId: string | undefined;
    let injected = false;
    let closeError: unknown;
    const appendSpy = vi.spyOn(f.store, 'append').mockImplementation((sessionId, events) => {
      if (
        !injected &&
        events.some((event) => event.type === 'message.completed' && event.runId === faultRunId)
      ) {
        injected = true;
        failed.release();
      }
      if (injected) throw failure;
      return originalAppend(sessionId, events);
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_JOURNAL_FAILURE',
        mode: 'send',
        requestId: 'journal-failure',
      });
      await withinDeadline(
        Promise.all([failureReady.promise, siblingReady.promise]),
        'Both child resources were not prepared',
      );
      faultRunId =
        f.runtime.agents.list(f.session.id).tasks.find((task) => task.title === 'Journal failure')
          ?.latestRunId ?? undefined;
      expect(faultRunId).toBeDefined();
      releaseFailure.release();
      await withinDeadline(failed.promise, 'Journal failure was not injected');
      await withinDeadline(siblingAborted.promise, 'Journal failure did not cancel the sibling');
      let closed = false;
      const closing = f.runtime.close().then(
        () => {
          closed = true;
        },
        (error: unknown) => {
          closeError = error;
          closed = true;
        },
      );
      await nextImmediate();
      expect(closed).toBe(false);
      expect(f.leases().released).toBeGreaterThanOrEqual(1);
      expect(f.leases().released).toBeLessThan(f.leases().acquired);
      settleSibling.release();
      await withinDeadline(closing, 'Tree close failed to wait for resource settlement');
      expect(f.leases().released).toBe(f.leases().acquired);
      expect(f.errors).toContain(failure);
      if (closeError !== undefined) expect(containsFailure(closeError, failure)).toBe(true);
    } finally {
      releaseFailure.release();
      settleSibling.release();
      appendSpy.mockRestore();
      if (closeError === undefined) await f.close();
      else await expect(f.close()).rejects.toBe(closeError);
    }
  });
});
