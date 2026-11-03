import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
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

describe('Subagent output recovery through real Pi and temporary journals', () => {
  it.each(['failed', 'bounded', 'length'] as const)(
    'marks a %s terminal answer as partial without changing its Run status',
    async (kind) => {
      const text =
        kind === 'bounded' ? 'x'.repeat(16_001) : 'Evidence received before the response ended.';
      const f = await agentFixture({
        response: (context) => {
          if (firstTask(context) === 'TERMINAL_OUTPUT')
            return fauxAssistantMessage(
              text,
              kind === 'failed'
                ? { stopReason: 'error', errorMessage: 'Request timed out.' }
                : kind === 'length'
                  ? { stopReason: 'length' }
                  : {},
            );
          if (!hasResult(context, 'spawn_agent'))
            return delegate('Terminal output', 'TERMINAL_OUTPUT');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Parent collected the bounded child output.');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_TERMINAL_OUTPUT',
          mode: 'send',
          requestId: kind,
        });
        await agentsIdle(f);
        const task = f.runtime.subagents.list(f.session.id).tasks[0];
        if (!task) throw new Error('Missing child task');
        const snapshot = f.store.getTaskSnapshot(f.session.id, task.id);
        const wait = f.runtime
          .getSnapshot(f.session.id)
          .tools.find((tool) => tool.name === 'wait_agents');
        const output: unknown = JSON.parse(wait?.result ?? 'null');
        expect(output).toEqual([
          expect.objectContaining({
            status: kind === 'failed' ? 'failed' : 'completed',
            partial: true,
            result: text.slice(0, 16_000),
            resultMessageId: snapshot.messages.at(-1)?.id,
          }),
        ]);
        expect(snapshot.messages.at(-1)?.text).toBe(text);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(['failed', 'cancelled', 'timeout'] as const)(
    'returns a child progress message with its actual %s outcome',
    async (outcome) => {
      const ready = agentGate();
      const blocked = agentGate();
      const progress = 'Verified one source; the remaining research is unfinished.';
      const f = await agentFixture({
        beforeStream: async (context, signal) => {
          if (firstTask(context) !== 'PARTIAL_CHILD' || !hasResult(context, 'tool_search')) return;
          ready.release();
          if (outcome !== 'failed') await waitAtGate(blocked, signal);
        },
        response: (context) => {
          if (firstTask(context) === 'PARTIAL_CHILD') {
            if (!hasResult(context, 'tool_search'))
              return fauxAssistantMessage(
                [
                  { type: 'text', text: progress },
                  {
                    type: 'toolCall',
                    id: 'partial-discovery',
                    name: 'tool_search',
                    arguments: { query: 'read_file', limit: 1 },
                  },
                ],
                { stopReason: 'toolUse' },
              );
            return fauxAssistantMessage('  ', {
              stopReason: 'error',
              errorMessage: 'Request timed out.',
            });
          }
          if (!hasResult(context, 'spawn_agent'))
            return call(
              'spawn_agent',
              {
                title: 'Recover unfinished research',
                task: 'PARTIAL_CHILD',
                roleId: 'researcher',
                ...(outcome === 'timeout' ? { limits: { timeoutMs: 1000 } } : {}),
              },
              'spawn-partial',
            );
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage(
            'Parent retained the incomplete findings without claiming success.',
          );
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_PARTIAL_RESULT',
          mode: 'send',
          requestId: outcome,
        });
        await withinDeadline(ready.promise, 'Child did not reach its second model request');
        const task = f.runtime.subagents.list(f.session.id).tasks[0];
        if (!task) throw new Error('Missing child task');
        if (outcome === 'cancelled')
          await f.runtime.subagents.stop(f.session.id, task.id, {
            expectedRunId: task.latestRunId,
          });
        await agentsIdle(f);
        const child = f.store.getTaskSnapshot(f.session.id, task.id);
        const status = outcome === 'cancelled' ? 'cancelled' : 'failed';
        const wait = f.runtime
          .getSnapshot(f.session.id)
          .tools.find((tool) => tool.name === 'wait_agents');
        const output: unknown = JSON.parse(wait?.result ?? 'null');
        const message = child.messages.find((entry) => entry.text === progress);
        expect(child.runs[0]?.status).toBe(status);
        expect(output).toEqual([
          expect.objectContaining({
            taskId: task.id,
            runId: child.runs[0]?.id,
            status,
            result: progress,
            resultMessageId: message?.id,
            partial: true,
          }),
        ]);
        expect(message).toMatchObject({ status: 'complete', stopReason: 'toolUse' });
        expect(
          f.requests.filter((request) => request.task === 'ROOT_PARTIAL_RESULT').at(-1)?.json,
        ).toContain('\\"partial\\":true');
        expect(f.errors).toEqual([]);
      } finally {
        blocked.release();
        await f.close();
      }
    },
  );

  it('returns an empty failed continuation without reusing the preceding Run answer', async () => {
    const f = await agentFixture({
      response: (context) => {
        if (firstTask(context) === 'CONTINUE_WITHOUT_OUTPUT') {
          const latest = [...context.messages].reverse().find((message) => message.role === 'user');
          if (typeof latest?.content === 'string' && latest.content.endsWith('FAIL_WITHOUT_OUTPUT'))
            return fauxAssistantMessage('', {
              stopReason: 'error',
              errorMessage: 'Request timed out.',
            });
          return fauxAssistantMessage('Conclusion from the first Run only.');
        }
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Continue with no new answer', 'CONTINUE_WITHOUT_OUTPUT');
        if (resultCount(context, 'wait_agents') === 0)
          return waitForResults(context, 'initial-wait');
        if (!hasResult(context, 'tool_search'))
          return call(
            'tool_search',
            { query: 'send_agent_message', limit: 1 },
            'load-continuation',
          );
        if (!hasResult(context, 'send_agent_message')) {
          const task = taskResults(context)[0];
          if (!task) throw new Error('Missing continuation target');
          return call(
            'send_agent_message',
            {
              target: { kind: 'task', taskId: task.id },
              text: 'FAIL_WITHOUT_OUTPUT',
              continue: true,
            },
            'empty-continuation',
          );
        }
        if (resultCount(context, 'wait_agents') === 1)
          return waitForResults(context, 'continued-wait');
        return fauxAssistantMessage('The continued Run failed and supplied no new result.');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_EMPTY_CONTINUATION',
        mode: 'send',
        requestId: 'empty-continuation',
      });
      await agentsIdle(f);
      const task = f.runtime.subagents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing continued task');
      const child = f.store.getTaskSnapshot(f.session.id, task.id);
      const waits = f.runtime
        .getSnapshot(f.session.id)
        .tools.filter((tool) => tool.name === 'wait_agents');
      const first: unknown = JSON.parse(waits[0]?.result ?? 'null');
      const last: unknown = JSON.parse(waits[1]?.result ?? 'null');
      expect(child.runs).toHaveLength(2);
      expect(first).toEqual([
        expect.objectContaining({
          status: 'completed',
          partial: false,
          result: 'Conclusion from the first Run only.',
        }),
      ]);
      expect(last).toEqual([
        expect.objectContaining({
          taskId: task.id,
          runId: task.latestRunId,
          status: 'failed',
          error: '模型请求超时，请稍后重试。',
          result: '',
          resultMessageId: null,
          partial: false,
        }),
      ]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
