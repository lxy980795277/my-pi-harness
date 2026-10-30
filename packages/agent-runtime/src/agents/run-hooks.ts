import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Api,
  type Model,
} from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import type { AgentRuntime } from './runtime.js';
import type { AgentNode } from './types.js';
import type { AgentRunHooks } from './ports.js';
import {
  AGENT_TOOL_DEFINITIONS,
  AgentIdInputSchema,
  SendAgentInputSchema,
  SpawnAgentInputSchema,
  WaitAgentsInputSchema,
  isAgentTool,
} from './definitions.js';
import { RuntimeError } from '../errors.js';

function failedStream(
  model: Model<Api>,
  error: unknown,
  signal: AbortSignal,
  failures: WeakMap<AssistantMessage, RuntimeError>,
) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: signal.aborted ? 'aborted' : 'error',
    timestamp: Date.now(),
    errorMessage: error instanceof RuntimeError ? error.message : '模型请求未能完成。',
  };
  if (error instanceof RuntimeError) failures.set(message, error);
  stream.push({ type: 'error', reason: signal.aborted ? 'aborted' : 'error', error: message });
  stream.end(message);
  return stream;
}

function waitForNodes(
  nodes: readonly AgentNode[],
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

/** Per-Run hooks reuse Pi while keeping task ownership outside the SDK loop. */
export function createAgentHooks(owner: AgentRuntime, node: AgentNode): AgentRunHooks {
  const failures = new WeakMap<AssistantMessage, RuntimeError>();
  const outputTokens = (maximum: number): number => {
    if (node.task || node.tree.nodes.size > 1)
      return Math.min(maximum, node.limits.maxOutputTokens);
    return maximum;
  };
  return {
    readOnly: node.task?.role.access === 'read-only',
    controls: {
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
          result = owner.send(node, target, args.text, toolCallId, args.continue === true);
        } else throw new RuntimeError('AGENT_ARGUMENTS_INVALID', '子 Agent 工具参数无效。');
        return [{ type: 'text', text: JSON.stringify(result) }];
      },
    },
    beforeTool(mutating, signal) {
      signal.throwIfAborted();
      node.controller.signal.throwIfAborted();
      if (node.task || node.tree.nodes.size > 1) owner.checkDeadline(node);
      if (!mutating) return Promise.resolve((): void => undefined);
      const id = node.task?.id ?? node.tree.rootRunId;
      if (node.tree.writer !== id)
        throw new RuntimeError(
          'AGENT_WRITE_CONFLICT',
          '写入拥有权已交给其他任务，请先等待该任务结束。',
        );
      node.tree.writes.set(id, (node.tree.writes.get(id) ?? 0) + 1);
      let released = false;
      return Promise.resolve((): void => {
        if (released) return;
        released = true;
        node.tree.writes.set(id, (node.tree.writes.get(id) ?? 1) - 1);
      });
    },
    async stream(model, context, options) {
      const signal = options?.signal
        ? AbortSignal.any([node.controller.signal, options.signal])
        : node.controller.signal;
      let release: (() => void) | undefined;
      try {
        signal.throwIfAborted();
        const delegated =
          node.task !== undefined || [...node.tree.nodes].some((entry) => entry.task !== undefined);
        if (delegated) owner.checkDeadline(node);
        node.requestCount += 1;
        const maxTurns = delegated ? node.limits.maxTurns : 32;
        if (node.requestCount > maxTurns)
          throw new RuntimeError('AGENT_TURN_LIMIT', '任务已达到模型请求轮数上限。');
        const maxTokens = Math.min(
          options?.maxTokens ?? model.maxTokens,
          outputTokens(model.maxTokens),
        );
        const scopes = [];
        for (let entry: AgentNode | undefined = node; entry; entry = entry.parent)
          if (entry.task)
            scopes.push({
              id: entry.task.id,
              concurrency: entry.limits.maxConcurrentRequests,
            });
        owner.waiting(node, 'model');
        release = await node.tree.scheduler.request(scopes, signal);
        owner.waiting(node, null);
        const execution = node.execution;
        if (!execution) throw new RuntimeError('AGENT_NOT_READY', '执行尚未完成初始化。');
        const stream = await execution.options.resolved.streamFn(model, context, {
          ...options,
          signal,
          maxTokens,
        });
        const releaseSlot = release;
        const completion = stream
          .result()
          .then(releaseSlot, (error: unknown) => {
            releaseSlot();
            owner.options.onError(error);
          })
          .finally(() => {
            node.requests.delete(completion);
          });
        node.requests.add(completion);
        return stream;
      } catch (error) {
        release?.();
        node.error = error;
        return failedStream(model, error, signal, failures);
      }
    },
    maxTurns: node.task ? node.limits.maxTurns : 32,
    outputTokens,
    failure: (message) => failures.get(message),
    incoming: () => owner.incoming(node),
    consume: (message, view) => {
      const current = owner.incoming(node).find((entry) => entry.id === message.id);
      if (!current)
        throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '通信已经被消费或目标执行已结束。');
      return [
        {
          type: 'task.message_consumed',
          runId: node.run.id,
          at: view.createdAt,
          data: { messageId: message.id, consumedRunId: node.run.id },
        },
      ];
    },
    async finish(cancel) {
      await Promise.all(node.requests);
      await owner.finish(node, cancel);
    },
    cancel: (reason) => owner.cancelSubtree(node, reason),
    fault: (error) => owner.failTree(node, error),
  };
}

/** Application-owned role descriptions become replayable model input at acceptance. */
export function agentContext(
  roles: readonly { id: string; name: string; description: string; enabled: boolean }[],
): string {
  const enabled = roles.filter((role) => role.enabled);
  if (enabled.length === 0) return '';
  return `Delegate independent, bounded work when useful. Use wait_agents to collect descendant results before your final answer; stop unnecessary tasks. Child contexts contain only explicitly forwarded inputs. Available roles:\n${enabled.map((role) => `${role.id}: ${role.name} — ${role.description}`).join('\n')}\nTask controls: ${AGENT_TOOL_DEFINITIONS.map((tool) => tool.name).join(', ')}.`;
}
