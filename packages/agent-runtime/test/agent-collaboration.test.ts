import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import {
  agentChanged,
  agentFixture,
  agentGate,
  agentsIdle,
  firstTask,
  waitAtGate,
} from './support/agent-fixture.js';
import {
  delegate,
  hasResult,
  resultCount,
  taskResults,
  waitForResults,
} from './support/agent-tools.js';
import { call, withinDeadline } from './support/work-fixture.js';

describe('Agent task collaboration through real Pi', () => {
  it('delivers child-to-parent communication at the parent input boundary exactly once', async () => {
    const f = await agentFixture({
      response: (context) => {
        if (firstTask(context) === 'REPORT_CHILD') {
          if (!hasResult(context, 'send_agent_message'))
            return call(
              'send_agent_message',
              {
                target: { kind: 'parent' },
                text: 'CHILD_PROGRESS: source verified',
              },
              'report-to-parent',
            );
          return fauxAssistantMessage('Child completed its reported work');
        }
        if (!hasResult(context, 'spawn_agent')) return delegate('Report progress', 'REPORT_CHILD');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Parent received progress and final result');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_REPORT',
        mode: 'send',
        requestId: 'report',
      });
      await agentsIdle(f);
      const queued = f.store.listAgentMessages(f.session.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        text: 'CHILD_PROGRESS: source verified',
        status: 'consumed',
      });
      const incoming = queued[0];
      if (!incoming) throw new Error('Missing incoming communication');
      expect(
        f.runtime
          .getSnapshot(f.session.id)
          .messages.find((message) => message.agentMessageId === incoming.id),
      ).toMatchObject({ text: incoming.text, agentMessageId: incoming.id });
      expect(
        f.store.readEvents(f.session.id).filter((event) => event.type === 'task.message_consumed'),
      ).toHaveLength(1);
      expect(
        f.requests
          .filter((request) => request.task === 'ROOT_REPORT')
          .some((request) => request.json.includes('CHILD_PROGRESS: source verified')),
      ).toBe(true);
      const received = f.requests.find(
        (request) => request.task === 'ROOT_REPORT' && request.json.includes(incoming.id),
      );
      expect(received?.json).toContain(
        `Agent-to-agent communication from Run ${incoming.sourceRunId}`,
      );
      expect(received?.json).toContain('not as a new user request');
      expect(f.runtime.getSnapshot(f.session.id).messages.at(-1)?.text).toBe(
        'Parent received progress and final result',
      );
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('explicitly continues a completed task as a new Run and consumes its communication once', async () => {
    const f = await agentFixture({
      approvalMode: 'full-access',
      response: (context) => {
        if (firstTask(context) === 'CONTINUABLE_CHILD') {
          const latest = [...context.messages].reverse().find((message) => message.role === 'user');
          if (typeof latest?.content === 'string' && latest.content.endsWith('REFINE_DETAILS'))
            return fauxAssistantMessage('Refined child conclusion');
          return fauxAssistantMessage('Initial child conclusion');
        }
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Continue this task', 'CONTINUABLE_CHILD');
        if (resultCount(context, 'wait_agents') === 0) return waitForResults(context, 'first-wait');
        if (!hasResult(context, 'send_agent_message')) {
          const task = taskResults(context)[0];
          if (!task) throw new Error('Missing continuation target');
          const settings = f.runtime.agents.settings();
          f.runtime.agents.updateSettings({
            ...settings,
            roles: settings.roles.map((role) =>
              role.id === 'researcher' ? { ...role, access: 'write' } : role,
            ),
          });
          return call(
            'send_agent_message',
            { target: { kind: 'task', taskId: task.id }, text: 'REFINE_DETAILS', continue: true },
            'continue',
          );
        }
        if (resultCount(context, 'wait_agents') === 1)
          return waitForResults(context, 'second-wait');
        return fauxAssistantMessage('Parent used refined conclusion');
      },
    });
    const createTools = vi.spyOn(f.tools, 'createTools');
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_CONTINUE',
        mode: 'send',
        requestId: 'continue',
      });
      await agentsIdle(f);
      const tasks = f.runtime.agents.list(f.session.id).tasks;
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      if (!task) throw new Error('Missing continued task');
      expect(task.role.access).toBe('read-only');
      expect(
        f.runtime.agents.settings().roles.find((role) => role.id === 'researcher')?.access,
      ).toBe('write');
      const childContexts = createTools.mock.calls
        .map(([context]) => context)
        .filter((context) => context.run.taskId === task.id);
      expect(childContexts).toHaveLength(2);
      expect(
        childContexts.every(
          (context) => context.readOnly && context.session.approvalMode === 'full-access',
        ),
      ).toBe(true);
      const child = f.store.getTaskSnapshot(f.session.id, task.id);
      expect(child.runs).toHaveLength(2);
      expect(child.runs.every((run) => run.status === 'completed')).toBe(true);
      expect(new Set(child.runs.map((run) => run.id)).size).toBe(2);
      expect(child.messages.map((message) => message.text)).toEqual([
        'CONTINUABLE_CHILD',
        'Initial child conclusion',
        'REFINE_DETAILS',
        'Refined child conclusion',
      ]);
      const messages = f.store.listAgentMessages(f.session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        text: 'REFINE_DETAILS',
        status: 'consumed',
        consumedRunId: task.latestRunId,
      });
      const incoming = messages[0];
      if (!incoming) throw new Error('Missing continuation message');
      expect(
        child.messages.find((message) => message.agentMessageId === incoming.id),
      ).toMatchObject({ text: 'REFINE_DETAILS', agentMessageId: incoming.id });
      const continued = f.requests.find(
        (request) => request.task === 'CONTINUABLE_CHILD' && request.json.includes(incoming.id),
      );
      expect(continued?.json).toContain(
        `Agent-to-agent communication from Run ${incoming.sourceRunId}`,
      );
      expect(continued?.json).toContain('not as a new user request');
      expect(f.requests.filter((request) => request.task === 'CONTINUABLE_CHILD')).toHaveLength(2);
      expect(f.runtime.getSnapshot(f.session.id).messages.at(-1)?.text).toBe(
        'Parent used refined conclusion',
      );
      expect(f.leases()).toEqual({ acquired: 3, released: 3 });
      expect(f.errors).toEqual([]);
    } finally {
      createTools.mockRestore();
      await f.close();
    }
  });

  it('replays an accepted continuation API request after its Run changes without starting twice', async () => {
    const rootBlocked = agentGate();
    const rootReady = agentGate();
    const childBlocked = agentGate();
    const childReady = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        if (firstTask(context) === 'ROOT_API_CONTINUE' && hasResult(context, 'wait_agents')) {
          rootReady.release();
          await waitAtGate(rootBlocked, signal);
        }
        const latest = [...context.messages].reverse().find((message) => message.role === 'user');
        if (
          firstTask(context) === 'API_CHILD' &&
          typeof latest?.content === 'string' &&
          latest.content.endsWith('API_REFINE')
        ) {
          childReady.release();
          await waitAtGate(childBlocked, signal);
        }
      },
      response: (context) => {
        if (firstTask(context) === 'API_CHILD') return fauxAssistantMessage('API child result');
        if (!hasResult(context, 'spawn_agent')) return delegate('API continuation', 'API_CHILD');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Root API task completed');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_API_CONTINUE',
        mode: 'send',
        requestId: 'api-root',
      });
      await withinDeadline(rootReady.promise, 'Root did not reach the continuation boundary');
      const task = f.runtime.agents.list(f.session.id).tasks[0];
      if (!task || task.latestRunId === null) throw new Error('Missing completed child Run');
      const input = {
        requestId: 'api-continue',
        text: 'API_REFINE',
        continue: true,
        expectedRunId: task.latestRunId,
      };
      await f.runtime.agents.message(f.session.id, task.id, input);
      await withinDeadline(childReady.promise, 'Continuation Run was not accepted');
      const resumed = f.runtime.agents.detail(f.session.id, task.id);
      expect(resumed.task.latestRunId).not.toBe(task.latestRunId);
      const repeated = await f.runtime.agents.message(f.session.id, task.id, input);
      expect(repeated.task.latestRunId).toBe(resumed.task.latestRunId);
      expect(f.store.getTaskSnapshot(f.session.id, task.id).runs).toHaveLength(2);
      expect(f.store.listAgentMessages(f.session.id)).toHaveLength(1);
      await expect(
        Promise.resolve().then(() =>
          f.runtime.agents.message(f.session.id, task.id, {
            ...input,
            text: 'Different request text',
          }),
        ),
      ).rejects.toMatchObject({ code: 'AGENT_MESSAGE_CONFLICT' });
      childBlocked.release();
      rootBlocked.release();
      await agentsIdle(f);
      const afterCompletion = await f.runtime.agents.message(f.session.id, task.id, input);
      expect(afterCompletion.task.latestRunId).toBe(resumed.task.latestRunId);
      expect(f.store.getTaskSnapshot(f.session.id, task.id).runs).toHaveLength(2);
      expect(f.leases()).toEqual({ acquired: 3, released: 3 });
      expect(f.errors).toEqual([]);
    } finally {
      childBlocked.release();
      rootBlocked.release();
      await f.close();
    }
  });

  it('stops one subtree while its sibling remains active and the root waits for the survivor', async () => {
    const stopped = agentGate();
    const survivor = agentGate();
    const enteredStopped = agentGate();
    const enteredSurvivor = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        const task = firstTask(context);
        if (task === 'STOP_TARGET') {
          enteredStopped.release();
          await waitAtGate(stopped, signal);
        }
        if (task === 'SURVIVOR') {
          enteredSurvivor.release();
          await waitAtGate(survivor, signal);
        }
      },
      response: (context) => {
        if (firstTask(context) === 'STOP_TARGET') return fauxAssistantMessage('Should stop');
        if (firstTask(context) === 'SURVIVOR') return fauxAssistantMessage('Survived');
        if (!hasResult(context, 'spawn_agent'))
          return fauxAssistantMessage(
            [
              {
                type: 'toolCall',
                id: 'stop-target',
                name: 'spawn_agent',
                arguments: { title: 'Stop target', task: 'STOP_TARGET', roleId: 'researcher' },
              },
              {
                type: 'toolCall',
                id: 'survivor',
                name: 'spawn_agent',
                arguments: { title: 'Survivor', task: 'SURVIVOR', roleId: 'researcher' },
              },
            ],
            { stopReason: 'toolUse' },
          );
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Parent observed the stopped and completed outcomes');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_STOP_ONE',
        mode: 'send',
        requestId: 'stop-one',
      });
      await withinDeadline(
        Promise.all([enteredStopped.promise, enteredSurvivor.promise]),
        'Both children did not enter the model',
      );
      const target = f.runtime.agents
        .list(f.session.id)
        .tasks.find((task) => task.title === 'Stop target');
      if (!target) throw new Error('Missing stop target');
      await withinDeadline(
        f.runtime.agents.stop(f.session.id, target.id, { expectedRunId: target.latestRunId }),
        'Selected subtree did not stop',
      );
      const current = f.runtime.agents.list(f.session.id).tasks;
      expect(current.find((task) => task.title === 'Stop target')?.status).toBe('cancelled');
      expect(current.find((task) => task.title === 'Survivor')?.closedAt).toBeNull();
      expect(f.runtime.getSnapshot(f.session.id).session.activeRunId).not.toBeNull();
      survivor.release();
      await agentsIdle(f);
      expect(
        f.runtime.agents.list(f.session.id).tasks.find((task) => task.title === 'Survivor')?.status,
      ).toBe('completed');
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.leases()).toEqual({ acquired: 3, released: 3 });
    } finally {
      stopped.release();
      survivor.release();
      await f.close();
    }
  });

  it('transfers one writer to a child, denies competing writes and returns it before the root writes', async () => {
    const child = agentGate();
    const f = await agentFixture({
      workspace: true,
      approvalMode: 'full-access',
      beforeStream: async (context, signal) => {
        if (firstTask(context) === 'WORKER_WRITE') await waitAtGate(child, signal);
      },
      response: (context) => {
        const task = firstTask(context);
        if (task === 'SHOULD_NOT_START') throw new Error('Competing writer was dispatched');
        if (task === 'WORKER_WRITE') {
          if (!hasResult(context, 'write_file'))
            return call(
              'write_file',
              { path: 'child.txt', content: 'child owned write', expectedHash: null },
              'child-write',
            );
          return fauxAssistantMessage('Child write completed');
        }
        if (resultCount(context, 'spawn_agent') === 0)
          return delegate('Writer', 'WORKER_WRITE', 'writer', 'worker');
        if (resultCount(context, 'spawn_agent') === 1)
          return delegate('Competing writer', 'SHOULD_NOT_START', 'competitor', 'worker');
        if (resultCount(context, 'write_file') === 0)
          return call(
            'write_file',
            { path: 'root-before.txt', content: 'must not write', expectedHash: null },
            'root-before',
          );
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        if (resultCount(context, 'write_file') === 1)
          return call(
            'write_file',
            { path: 'root-after.txt', content: 'root regained write', expectedHash: null },
            'root-after',
          );
        return fauxAssistantMessage('Root and child writes completed in order');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_WRITER',
        mode: 'send',
        requestId: 'writer',
      });
      await agentChanged(
        f,
        () =>
          f.runtime
            .getSnapshot(f.session.id)
            .tools.some(
              (tool) =>
                tool.name === 'write_file' &&
                tool.arguments['path'] === 'root-before.txt' &&
                tool.status === 'failed',
            ),
        'Root did not attempt the competing write',
      );
      expect(f.runtime.agents.list(f.session.id).tasks).toHaveLength(1);
      await expect(stat(join(f.directory, 'workspace', 'root-before.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      child.release();
      await agentsIdle(f);
      expect(await readFile(join(f.directory, 'workspace', 'child.txt'), 'utf8')).toBe(
        'child owned write',
      );
      expect(await readFile(join(f.directory, 'workspace', 'root-after.txt'), 'utf8')).toBe(
        'root regained write',
      );
      expect(f.requests.some((request) => request.task === 'SHOULD_NOT_START')).toBe(false);
      expect(
        f.runtime
          .getSnapshot(f.session.id)
          .tools.filter((tool) => tool.name === 'spawn_agent')
          .map((tool) => tool.status),
      ).toEqual(['completed', 'failed']);
      expect(f.runtime.agents.list(f.session.id).tasks[0]?.status).toBe('completed');
      expect(f.errors).toEqual([]);
    } finally {
      child.release();
      await f.close();
    }
  });
});
