import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  agentFixture,
  agentGate,
  agentsIdle,
  firstTask,
  waitAtGate,
} from './support/agent-fixture';
import {
  delegate,
  hasResult,
  resultCount,
  taskResults,
  waitForResults,
} from './support/agent-tools';
import { call, withinDeadline } from './support/work-fixture';

describe('request ownership across root inputs and delegated continuations', () => {
  it('retains an active child on its first answer after the root has consumed a second question', async () => {
    const childReady = agentGate();
    const childFinish = agentGate();
    const rootReady = agentGate();
    const rootProceed = agentGate();
    const secondConsumed = agentGate();
    let paused = false;
    const f = await agentFixture({
      settings: (settings) => ({
        ...settings,
        limits: { ...settings.limits, maxConcurrentRequests: 2 },
      }),
      beforeStream: async (context, signal) => {
        if (firstTask(context) === 'LATE_CHILD') {
          childReady.release();
          await waitAtGate(childFinish, signal);
          return;
        }
        const latest = [...context.messages].reverse().find((message) => message.role === 'user');
        if (latest?.content === 'SECOND_WHILE_CHILD') secondConsumed.release();
        if (!paused && hasResult(context, 'spawn_agent')) {
          paused = true;
          rootReady.release();
          await waitAtGate(rootProceed, signal);
        }
      },
      response: (context) => {
        if (firstTask(context) === 'LATE_CHILD')
          return fauxAssistantMessage('Late first-answer work');
        if (!hasResult(context, 'spawn_agent')) return delegate('Late child', 'LATE_CHILD');
        const latest = [...context.messages].reverse().find((message) => message.role === 'user');
        if (latest?.content !== 'SECOND_WHILE_CHILD') return fauxAssistantMessage('First response');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Second response');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_WITH_CHILD',
        mode: 'send',
        requestId: 'first',
      });
      await withinDeadline(
        Promise.all([rootReady.promise, childReady.promise]),
        'Parent/child did not reach the controlled overlap',
      );
      await f.runtime.send(f.session.id, {
        text: 'SECOND_WHILE_CHILD',
        mode: 'steer',
        requestId: 'second',
      });
      rootProceed.release();
      await withinDeadline(secondConsumed.promise, 'Root did not consume the second question');
      childFinish.release();
      await agentsIdle(f);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      const first = snapshot.messages.find((message) => message.text === 'ROOT_WITH_CHILD');
      const second = snapshot.messages.find((message) => message.text === 'SECOND_WHILE_CHILD');
      const task = f.runtime.subagents.list(f.session.id).tasks[0];
      if (!first || !second || !task?.latestRunId)
        throw new Error('Missing overlapping input/task records');
      const events = f.store.readEvents(f.session.id, 0, 1000);
      const child = events.find(
        (event) => event.type === 'model.request.started' && event.runId === task.latestRunId,
      );
      const laterRoot = events.find(
        (event) =>
          event.type === 'model.request.started' && event.data.inputMessageId === second.id,
      );
      const completion = events.find(
        (event) => event.type === 'model.request.completed' && event.runId === task.latestRunId,
      );
      expect(child?.data.answerInputMessageId).toBe(first.id);
      expect(laterRoot?.data.answerInputMessageId).toBe(second.id);
      expect(completion?.seq).toBeGreaterThan(laterRoot?.seq ?? Number.MAX_SAFE_INTEGER);
      expect(
        f.store.getSessionUsage(f.session.id, {
          inputMessageId: second.id,
          includeDescendants: true,
        }).requestCount,
      ).toBe(2);
      expect(f.errors).toEqual([]);
    } finally {
      rootProceed.release();
      childFinish.release();
      await f.close();
    }
  });

  it('keeps the initial child on its original answer and attributes a later continuation to the consumed steer', async () => {
    const boundary = agentGate();
    const proceed = agentGate();
    let paused = false;
    const f = await agentFixture({
      beforeStream: async (context, signal) => {
        if (
          !paused &&
          firstTask(context) === 'ROOT_FIRST' &&
          hasResult(context, 'wait_agents') &&
          !hasResult(context, 'tool_search')
        ) {
          paused = true;
          boundary.release();
          await waitAtGate(proceed, signal);
        }
      },
      response: (context) => {
        if (firstTask(context) === 'LEDGER_CHILD') {
          const latest = [...context.messages].reverse().find((message) => message.role === 'user');
          return fauxAssistantMessage(
            typeof latest?.content === 'string' && latest.content.endsWith('REFINE_FOR_SECOND')
              ? 'Refined for the second question'
              : 'Initial answer for the first question',
          );
        }
        if (!hasResult(context, 'spawn_agent')) return delegate('Ledger child', 'LEDGER_CHILD');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context, 'initial-wait');
        if (!hasResult(context, 'tool_search'))
          return call('tool_search', { query: 'send_agent_message', limit: 1 }, 'find-send');
        if (!hasResult(context, 'send_agent_message')) {
          const child = taskResults(context)[0];
          if (!child) throw new Error('Missing continuation target');
          return call(
            'send_agent_message',
            {
              target: { kind: 'task', taskId: child.id },
              text: 'REFINE_FOR_SECOND',
              continue: true,
            },
            'continue-second',
          );
        }
        if (resultCount(context, 'wait_agents') === 1)
          return waitForResults(context, 'refined-wait');
        return fauxAssistantMessage('Second question completed');
      },
    });
    try {
      await f.runtime.send(f.session.id, { text: 'ROOT_FIRST', mode: 'send', requestId: 'first' });
      await withinDeadline(boundary.promise, 'Root never reached the second-input boundary');
      await f.runtime.send(f.session.id, {
        text: 'ROOT_SECOND',
        mode: 'steer',
        requestId: 'second',
      });
      proceed.release();
      await agentsIdle(f);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      const first = snapshot.messages.find((message) => message.text === 'ROOT_FIRST');
      const second = snapshot.messages.find((message) => message.text === 'ROOT_SECOND');
      const child = f.runtime.subagents.list(f.session.id).tasks[0];
      if (!first || !second || !child) throw new Error('Missing completed input/task records');
      const childSnapshot = f.store.getTaskSnapshot(f.session.id, child.id);
      expect(childSnapshot.runs).toHaveLength(2);
      const requests = f.store
        .readEvents(f.session.id, 0, 1000)
        .filter((event) => event.type === 'model.request.started');
      const childRequests = requests.filter((event) =>
        childSnapshot.runs.some((run) => run.id === event.runId),
      );
      expect(childRequests).toHaveLength(2);
      expect(childRequests.map((event) => event.data.answerInputMessageId)).toEqual([
        first.id,
        second.id,
      ]);
      expect(
        childRequests.every(
          (event) => event.data.inputMessageId !== event.data.answerInputMessageId,
        ),
      ).toBe(true);
      expect(f.store.listAgentMessages(f.session.id)[0]?.answerInputMessageId).toBe(second.id);
      expect(
        requests.find((event) => event.data.inputMessageId === second.id)?.data
          .answerInputMessageId,
      ).toBe(second.id);
      expect(snapshot.runs[0]?.status).toBe('completed');
      expect(
        f.store.getSessionUsage(f.session.id, {
          inputMessageId: second.id,
          includeDescendants: true,
        }).requestCount,
      ).toBe(4);
      expect(f.errors).toEqual([]);
    } finally {
      proceed.release();
      await f.close();
    }
  });
});
