import { Value } from 'typebox/value';
import type {
  AgentMessage,
  AgentMessageTarget,
  AgentTaskDetail,
  AgentTaskStop,
  AgentTaskSummary,
} from '@my-pi-harness/protocol';
import type { AgentToolControls } from '../tools/types.js';
import type { SubagentNode, SubagentTaskNode } from './types.js';
import type { SubagentStore } from './ports.js';
import {
  AgentIdInputSchema,
  SendAgentInputSchema,
  SpawnAgentInputSchema,
  WaitAgentsInputSchema,
  isAgentTool,
  type SpawnAgentInput,
} from './definitions.js';
import { RuntimeError } from '../errors.js';

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

/** Dispatch audited delegation tools without owning request streaming or task state. */
export function createSubagentToolControls(
  owner: SubagentToolHost,
  node: SubagentNode,
): AgentToolControls {
  return {
    has: isAgentTool,
    async execute(name, args, toolCallId, signal) {
      signal.throwIfAborted();
      let result: unknown;
      if (name === 'spawn_agent' && Value.Check(SpawnAgentInputSchema, args)) {
        const task = owner.spawn(node, toolCallId, args);
        result = {
          id: task.id,
          title: task.title,
          roleId: task.role.id,
          status: task.status,
          runId: task.latestRunId,
        };
      } else if (name === 'get_agent_status' && Value.Check(AgentIdInputSchema, args))
        result = owner.result(node, args.taskId);
      else if (name === 'wait_agents' && Value.Check(WaitAgentsInputSchema, args)) {
        const targets = owner.descendants(node, args.taskIds);
        owner.waiting(node, 'children');
        try {
          await waitForNodes(targets, args.mode === 'any', args.timeoutMs ?? 60_000, signal);
        } finally {
          owner.waiting(node, null);
        }
        result = targets.map((target) => owner.result(node, target.task.id, target.run.id));
      } else if (name === 'stop_agent' && Value.Check(AgentIdInputSchema, args)) {
        owner.descendants(node, [args.taskId]);
        const task = owner.options.store.getAgentTask(node.session.id, args.taskId);
        if (!task) throw new RuntimeError('AGENT_NOT_FOUND', '任务不存在。');
        await owner.stop(node.session.id, args.taskId, { expectedRunId: task.latestRunId });
        result = owner.result(node, args.taskId);
      } else if (name === 'send_agent_message' && Value.Check(SendAgentInputSchema, args)) {
        const target =
          args.target.kind === 'parent'
            ? { kind: 'run' as const, runId: node.parent?.run.id ?? '' }
            : args.target;
        if (target.kind === 'run' && !target.runId)
          throw new RuntimeError('AGENT_SCOPE', '根 Agent 没有父任务。');
        result = owner.messaging.send(node, target, args.text, toolCallId, args.continue === true);
      } else throw new RuntimeError('AGENT_ARGUMENTS_INVALID', '子 Agent 工具参数无效。');
      return [{ type: 'text', text: JSON.stringify(result) }];
    },
  };
}
