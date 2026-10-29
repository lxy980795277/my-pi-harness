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
import { call, withinDeadline } from './support/work-fixture.js';
import { delegate, hasResult, resultCount, waitForResults } from './support/agent-tools.js';

describe('durable structured Agent execution through real Pi', () => {
  it('delegates isolated input, collects a real child result and keeps child transcript out of root messages', async () => {
    const affinity = new Map<string, string | undefined>();
    const f = await agentFixture({
      beforeStream: (context, _signal, sessionId) => {
        affinity.set(firstTask(context), sessionId);
        return Promise.resolve();
      },
      response: (context) => {
        if (firstTask(context) === 'TASK_ONLY_CONTEXT')
          return fauxAssistantMessage('Alpha-only observation');
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Inspect alpha', 'TASK_ONLY_CONTEXT');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Parent summarized alpha');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_SECRET_KEEP: delegate a check',
        mode: 'send',
        requestId: 'isolation',
      });
      await agentsIdle(f);
      const tasks = f.runtime.agents.list(f.session.id).tasks;
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      if (!task) throw new Error('Missing accepted task');
      expect(task.status).toBe('completed');
      expect(task.closedAt).not.toBeNull();
      const root = f.runtime.getSnapshot(f.session.id);
      const child = f.store.getTaskSnapshot(f.session.id, task.id);
      expect(
        root.messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.text),
      ).toContain('Parent summarized alpha');
      expect(root.messages.some((message) => message.text === 'Alpha-only observation')).toBe(
        false,
      );
      expect(root.runs).toHaveLength(1);
      expect(child.messages.map((message) => message.text)).toEqual([
        'TASK_ONLY_CONTEXT',
        'Alpha-only observation',
      ]);
      expect(child.runs).toHaveLength(1);
      expect(child.runs[0]?.taskId).toBe(task.id);
      expect(affinity.get('TASK_ONLY_CONTEXT')).toBe(task.id);
      expect(affinity.get('ROOT_SECRET_KEEP: delegate a check')).toBe(f.session.id);
      expect(
        f.requests.find((request) => request.task === 'TASK_ONLY_CONTEXT')?.json,
      ).not.toContain('ROOT_SECRET_KEEP');
      expect(root.tools.find((tool) => tool.name === 'wait_agents')?.result).toContain(
        'Alpha-only observation',
      );
      expect(f.leases()).toEqual({ acquired: 2, released: 2 });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('stops the entire tree while a child model is running and waits for both leases to settle', async () => {
    const blocked = agentGate();
    const entered = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        if (firstTask(context) !== 'BLOCK_CHILD_MODEL') return;
        entered.release();
        await waitAtGate(blocked, signal);
      },
      response: (context) => {
        if (firstTask(context) === 'BLOCK_CHILD_MODEL')
          return fauxAssistantMessage('Child should be cancelled');
        if (!hasResult(context, 'spawn_agent')) return delegate('Slow child', 'BLOCK_CHILD_MODEL');
        return waitForResults(context);
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_STOP',
        mode: 'send',
        requestId: 'stop-model',
      });
      await withinDeadline(entered.promise, 'Child model never started');
      await withinDeadline(f.runtime.cancel(f.session.id), 'Tree cancellation did not settle');
      const task = f.runtime.agents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing cancelled task');
      expect(task.status).toBe('cancelled');
      expect(task.closedAt).not.toBeNull();
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('cancelled');
      expect(f.store.getTaskSnapshot(f.session.id, task.id).runs[0]?.status).toBe('cancelled');
      expect(f.leases()).toEqual({ acquired: 2, released: 2 });
    } finally {
      blocked.release();
      await f.close();
    }
  });

  it('cancels child preparation before acceptance without leaving an orphan or acquiring an unused lease', async () => {
    const blocked = agentGate();
    const entered = agentGate();
    const f = await agentFixture({
      beforeResolve: async (index, signal) => {
        if (index !== 2) return;
        entered.release();
        await waitAtGate(blocked, signal);
      },
      response: (context) => {
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Preparing child', 'PREPARING_CHILD');
        return waitForResults(context);
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_PREPARE_STOP',
        mode: 'send',
        requestId: 'stop-prepare',
      });
      await withinDeadline(entered.promise, 'Child preparation never started');
      await withinDeadline(
        f.runtime.cancel(f.session.id),
        'Preparation cancellation did not settle',
      );
      const task = f.runtime.agents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing preparing task');
      expect(task.status).toBe('cancelled');
      expect(task.latestRunId).toBeNull();
      expect(task.closedAt).not.toBeNull();
      expect(f.store.getTaskSnapshot(f.session.id, task.id).runs).toEqual([]);
      expect(f.leases()).toEqual({ acquired: 1, released: 1 });
      expect(f.runtime.getSnapshot(f.session.id).session.activeRunId).toBeNull();
    } finally {
      blocked.release();
      await f.close();
    }
  });

  it('runs parallel and nested tasks with a single model slot without a parent-wait deadlock', async () => {
    const f = await agentFixture({
      approvalMode: 'full-access',
      settings: (settings) => ({
        ...settings,
        limits: { ...settings.limits, maxConcurrentRequests: 1 },
      }),
      response: (context) => {
        const input = firstTask(context);
        if (input === 'LEAF_TASK') return fauxAssistantMessage('Leaf verified');
        if (input === 'RIGHT_READER') return fauxAssistantMessage('Right verified');
        if (input === 'LEFT_DELEGATOR') {
          if (resultCount(context, 'spawn_agent') === 0)
            return delegate('Forbidden writer', 'NEVER_WRITER', 'forbidden-writer', 'worker');
          if (resultCount(context, 'spawn_agent') === 1)
            return delegate('Leaf', 'LEAF_TASK', 'leaf-spawn');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context, 'leaf-wait');
          return fauxAssistantMessage('Left verified leaf');
        }
        if (!hasResult(context, 'spawn_agent'))
          return fauxAssistantMessage(
            [
              {
                type: 'toolCall',
                id: 'left-spawn',
                name: 'spawn_agent',
                arguments: { title: 'Left', task: 'LEFT_DELEGATOR', roleId: 'researcher' },
              },
              {
                type: 'toolCall',
                id: 'right-spawn',
                name: 'spawn_agent',
                arguments: { title: 'Right', task: 'RIGHT_READER', roleId: 'researcher' },
              },
            ],
            { stopReason: 'toolUse' },
          );
        if (!hasResult(context, 'wait_agents')) return waitForResults(context, 'root-wait');
        return fauxAssistantMessage('Root verified both branches');
      },
    });
    const createTools = vi.spyOn(f.tools, 'createTools');
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_NESTED',
        mode: 'send',
        requestId: 'nested',
      });
      await agentsIdle(f);
      const tasks = f.runtime.agents.list(f.session.id).tasks;
      expect(tasks).toHaveLength(3);
      expect(tasks.every((task) => task.status === 'completed' && task.closedAt !== null)).toBe(
        true,
      );
      const left = tasks.find((task) => task.title === 'Left');
      const leaf = tasks.find((task) => task.title === 'Leaf');
      expect(leaf?.parentTaskId).toBe(left?.id);
      const childContexts = createTools.mock.calls
        .map(([context]) => context)
        .filter((context) => context.run.taskId !== undefined);
      expect(childContexts).toHaveLength(3);
      expect(
        childContexts.every(
          (context) => context.readOnly && context.session.approvalMode === 'full-access',
        ),
      ).toBe(true);
      expect(f.requests.some((request) => request.task === 'NEVER_WRITER')).toBe(false);
      if (!left) throw new Error('Missing delegating task');
      expect(
        f.store
          .getTaskSnapshot(f.session.id, left.id)
          .tools.find((tool) => tool.name === 'spawn_agent')?.result,
      ).toContain('只读任务不能创建写入角色');
      expect(f.maxRequests()).toBe(1);
      expect(f.leases()).toEqual({ acquired: 4, released: 4 });
      expect(f.runtime.getSnapshot(f.session.id).messages.at(-1)?.text).toBe(
        'Root verified both branches',
      );
      expect(f.errors).toEqual([]);
    } finally {
      createTools.mockRestore();
      await f.close();
    }
  });

  it('joins an existing child after an early parent answer and writes the parent terminal outcome last', async () => {
    const blocked = agentGate();
    const entered = agentGate();
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        if (firstTask(context) !== 'EARLY_CHILD') return;
        entered.release();
        await waitAtGate(blocked, signal);
      },
      response: (context) => {
        if (firstTask(context) === 'EARLY_CHILD') return fauxAssistantMessage('Late child result');
        if (!hasResult(context, 'spawn_agent')) return delegate('Existing child', 'EARLY_CHILD');
        return fauxAssistantMessage('Early parent answer');
      },
    });
    try {
      await f.runtime.send(f.session.id, { text: 'ROOT_EARLY', mode: 'send', requestId: 'early' });
      await withinDeadline(entered.promise, 'Child did not enter the model');
      await agentChanged(
        f,
        () =>
          f.runtime
            .getSnapshot(f.session.id)
            .messages.some(
              (message) => message.text === 'Early parent answer' && message.status === 'complete',
            ),
        'Parent did not finish its answer',
      );
      const rootRunId = f.runtime.getSnapshot(f.session.id).session.activeRunId;
      expect(rootRunId).not.toBeNull();
      expect(f.runtime.agents.list(f.session.id).tasks[0]?.closedAt).toBeNull();
      blocked.release();
      await agentsIdle(f);
      const task = f.runtime.agents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing joined task');
      expect(task.status).toBe('completed');
      expect(task.closedAt).not.toBeNull();
      const events = f.store.readEvents(f.session.id);
      const childFinished = events.find(
        (event) => event.type === 'run.finished' && event.runId === task.latestRunId,
      );
      const parentFinished = events.find(
        (event) => event.type === 'run.finished' && event.runId === rootRunId,
      );
      expect(childFinished?.seq).toBeLessThan(parentFinished?.seq ?? 0);
      expect(f.requests.filter((request) => request.task === 'ROOT_EARLY')).toHaveLength(2);
      expect(f.leases()).toEqual({ acquired: 2, released: 2 });
      expect(f.errors).toEqual([]);
    } finally {
      blocked.release();
      await f.close();
    }
  });

  it('keeps a child question out of root work and resumes only its original task on answer', async () => {
    const f = await agentFixture({
      response: (context) => {
        if (firstTask(context) === 'ASK_CHILD') {
          if (!hasResult(context, 'ask_user'))
            return call(
              'ask_user',
              {
                questions: [
                  {
                    id: 'choice',
                    header: 'Child choice',
                    prompt: 'Which source?',
                    options: [],
                    multiSelect: false,
                    allowCustomInput: true,
                  },
                ],
              },
              'child-question',
            );
          return fauxAssistantMessage('Child received the selected source');
        }
        if (!hasResult(context, 'spawn_agent')) return delegate('Ask for source', 'ASK_CHILD');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Parent summarized the confirmed source');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_QUESTION',
        mode: 'send',
        requestId: 'question',
      });
      await agentChanged(
        f,
        () =>
          f.runtime.agents
            .list(f.session.id)
            .tasks.some((task) =>
              f.store
                .getTaskWorkState(f.session.id, task.id)
                .questions.some((question) => question.status === 'pending'),
            ),
        'Child did not ask its question',
      );
      const task = f.runtime.agents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing questioning task');
      const question = f.store.getTaskWorkState(f.session.id, task.id).questions[0];
      if (!question) throw new Error('Missing task question');
      const answers = [{ questionId: 'choice', optionIds: [], text: 'Verified source A' }];
      expect(f.work.snapshot(f.session.id).state.questions).toEqual([]);
      await expect(f.work.answer(f.session.id, question.id, answers)).rejects.toMatchObject({
        code: 'QUESTION_CONFLICT',
      });
      await f.work.answer(f.session.id, question.id, answers, task.id);
      await agentsIdle(f);
      expect(f.store.getTaskWorkState(f.session.id, task.id).questions[0]?.status).toBe('answered');
      expect(f.work.snapshot(f.session.id).state.questions).toEqual([]);
      expect(f.runtime.getSnapshot(f.session.id).messages.at(-1)?.text).toBe(
        'Parent summarized the confirmed source',
      );
      expect(
        f.requests.find(
          (request) => request.task === 'ASK_CHILD' && request.json.includes('Verified source A'),
        ),
      ).toBeDefined();
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
