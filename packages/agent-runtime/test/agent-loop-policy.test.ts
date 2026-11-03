import { fauxAssistantMessage, type ToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { agentFixture, agentsIdle, firstTask } from './support/agent-fixture.js';
import { delegate, hasResult, resultCount, waitForResults } from './support/agent-tools.js';

describe('Agent loop completion through real Pi and temporary journals', () => {
  it.each([false, true])(
    'finishes 33 tool rounds and 66 tool calls without a cumulative request or tool limit (delegated=%s)',
    async (delegated) => {
      const f = await agentFixture({
        workspace: true,
        response: (context) => {
          if (delegated && firstTask(context) === 'LONG_ROOT') {
            if (!hasResult(context, 'spawn_agent')) return delegate('Long child', 'LONG_CHILD');
            if (!hasResult(context, 'wait_agents')) return waitForResults(context);
            return fauxAssistantMessage('Parent collected the long child');
          }
          const completed = resultCount(context, 'list_files');
          if (completed < 66)
            return fauxAssistantMessage(
              [0, 1].map(
                (offset): ToolCall => ({
                  type: 'toolCall',
                  id: `files-${String(completed + offset)}`,
                  name: 'list_files',
                  arguments: { path: '.' },
                }),
              ),
              { stopReason: 'toolUse' },
            );
          return fauxAssistantMessage('Finished after 33 tool rounds');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'LONG_ROOT',
          mode: 'send',
          requestId: `long-loop-${String(delegated)}`,
        });
        await agentsIdle(f);
        const root = f.runtime.getSnapshot(f.session.id);
        expect(root.runs[0]).toMatchObject({ status: 'completed', error: null });
        if (delegated) {
          const tasks = f.runtime.subagents.list(f.session.id).tasks;
          expect(tasks).toHaveLength(1);
          const task = tasks[0];
          if (!task) throw new Error('Missing delegated long-loop task');
          expect(task).toMatchObject({ status: 'completed', error: null });
          const child = f.store.getTaskSnapshot(f.session.id, task.id);
          expect(child.tools).toHaveLength(66);
          expect(child.tools.every((tool) => tool.status === 'completed')).toBe(true);
          expect(f.requests.filter((request) => request.task === 'LONG_CHILD')).toHaveLength(34);
          expect(root.messages.at(-1)?.text).toBe('Parent collected the long child');
        } else {
          expect(f.requests).toHaveLength(34);
          expect(root.tools).toHaveLength(66);
          expect(root.tools.every((tool) => tool.status === 'completed')).toBe(true);
          expect(root.messages.at(-1)?.text).toBe('Finished after 33 tool rounds');
        }
        expect(f.leases()).toEqual({ acquired: delegated ? 2 : 1, released: delegated ? 2 : 1 });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );
});
