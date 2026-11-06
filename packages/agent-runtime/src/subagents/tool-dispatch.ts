import type {
  AgentMessage,
  AgentMessageTarget,
  AgentTaskDetail,
  AgentTaskStop,
  AgentTaskSummary,
} from '@my-pi-harness/protocol';
import type { AgentToolHandlers, SpawnAgentInput } from '@my-pi-harness/tools';
import type { SubagentNode, SubagentTaskNode } from './types';
import type { SubagentStore } from './ports';
import { RuntimeError } from '../errors';

/** Operations used by the model-facing delegation controls. */
export interface SubagentToolHost {
  readonly options: { readonly store: Pick<SubagentStore, 'getAgentTask'> };
  readonly messaging: {
    send(
      sender: SubagentNode,
      target: AgentMessageTarget,
      text: string,
      requestId: string,
      continueRun: boolean,
    ): AgentMessage;
  };
  spawn(parent: SubagentNode, toolCallId: string, input: SpawnAgentInput): AgentTaskSummary;
  result(caller: SubagentNode, taskId: string, expectedRunId?: string): Record<string, unknown>;
  descendants(caller: SubagentNode, ids: readonly string[]): SubagentTaskNode[];
  waiting(node: SubagentNode, waiting: AgentTaskSummary['waiting']): void;
  stop(sessionId: string, taskId: string, input: AgentTaskStop): Promise<AgentTaskDetail>;
}

function waitForNodes(
  nodes: readonly SubagentNode[],
  any: boolean,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (timeoutMs === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const complete = (): void => {
      cleanup();
      resolve();
    };
    const fail = (error: unknown): void => {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new RuntimeError('AGENT_WAIT_FAILED', '等待子任务失败。', { cause: error }),
      );
    };
    const abort = (): void => {
      fail(signal.reason);
    };
    const timer = setTimeout(complete, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    const pending = nodes.map((node) => node.promise);
    const done = any ? Promise.race(pending) : Promise.all(pending);
    done.then(complete, fail);
    if (signal.aborted) abort();
  });
}

/** Bind delegation operations to the caller's execution tree. */
export function createSubagentToolControls(
  owner: SubagentToolHost,
  node: SubagentNode,
): AgentToolHandlers {
  return {
    spawn(input, i) {
      i.signal.throwIfAborted();
      const task = owner.spawn(node, i.toolCallId, input);
      return Promise.resolve({
        id: task.id,
        title: task.title,
        roleId: task.role.id,
        status: task.status,
        runId: task.latestRunId,
      });
    },
    status(taskId) {
      return Promise.resolve(owner.result(node, taskId));
    },
    async wait(input, signal) {
      const targets = owner.descendants(node, input.taskIds);
      owner.waiting(node, 'children');
      try {
        await waitForNodes(targets, input.mode === 'any', input.timeoutMs ?? 60_000, signal);
      } finally {
        owner.waiting(node, null);
      }
      return targets.map((target) => owner.result(node, target.task.id, target.run.id));
    },
    async stop(taskId) {
      owner.descendants(node, [taskId]);
      const task = owner.options.store.getAgentTask(node.session.id, taskId);
      if (!task) throw new RuntimeError('AGENT_NOT_FOUND', '任务不存在。');
      await owner.stop(node.session.id, taskId, { expectedRunId: task.latestRunId });
      return owner.result(node, taskId);
    },
    send(input, i) {
      i.signal.throwIfAborted();
      const target =
        input.target.kind === 'parent'
          ? { kind: 'run' as const, runId: node.parent?.run.id ?? '' }
          : input.target;
      if (target.kind === 'run' && !target.runId)
        throw new RuntimeError('AGENT_SCOPE', '根 Agent 没有父任务。');
      return Promise.resolve(
        owner.messaging.send(node, target, input.text, i.toolCallId, input.continue === true),
      );
    },
  };
}
