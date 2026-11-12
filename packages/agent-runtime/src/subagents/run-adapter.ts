import { randomUUID } from 'node:crypto';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Api,
  type Model,
} from '@earendil-works/pi-ai';
import type { AgentMessage, MessageView } from '@my-pi-harness/protocol';
import type { RunHooks } from '../runs/ports';
import { communicationMessage } from '../context/agent-message';
import { encodeContextMessage } from '../context/codec';
import { RuntimeError } from '../errors';
import type { SubagentNode } from './types';
import { createSubagentToolControls, type SubagentToolHost } from './tool-dispatch';

/** Task lifecycle and messaging operations supplied to one Run adapter. */
export interface SubagentRunHost extends SubagentToolHost {
  readonly options: SubagentToolHost['options'] & { onError(error: unknown): void };
  readonly messaging: SubagentToolHost['messaging'] & {
    incoming(node: SubagentNode): AgentMessage[];
  };
  checkDeadline(node: SubagentNode): void;
  finish(node: SubagentNode, cancel: boolean): Promise<void>;
  cancelSubtree(node: SubagentNode, reason: string): void;
  failTree(node: SubagentNode, error: unknown): void;
}

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

/** Adapt task scheduling and lifecycle to the generic Run extension interface. */
export function createSubagentRunAdapter(owner: SubagentRunHost, node: SubagentNode): RunHooks {
  const failures = new WeakMap<AssistantMessage, RuntimeError>();
  const outputTokens = (maximum: number): number => {
    if (node.task || node.tree.nodes.size > 1)
      return Math.min(maximum, node.limits.maxOutputTokens);
    return maximum;
  };
  return {
    readOnly: node.task?.role.access === 'read-only',
    controls: createSubagentToolControls(owner, node),
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
    async acquireRequest(signal) {
      const combined = AbortSignal.any([node.controller.signal, signal]);
      combined.throwIfAborted();
      if (node.task || node.tree.nodes.size > 1) owner.checkDeadline(node);
      const scopes = [];
      for (let entry: SubagentNode | undefined = node; entry; entry = entry.parent)
        if (entry.task)
          scopes.push({ id: entry.task.id, concurrency: entry.limits.maxConcurrentRequests });
      owner.waiting(node, 'model');
      try {
        return await node.tree.scheduler.request(scopes, combined);
      } finally {
        owner.waiting(node, null);
      }
    },
    async stream(model, context, options) {
      const signal = options?.signal
        ? AbortSignal.any([node.controller.signal, options.signal])
        : node.controller.signal;
      try {
        signal.throwIfAborted();
        if (node.task || node.tree.nodes.size > 1) owner.checkDeadline(node);
        const execution = node.execution;
        if (!execution) throw new RuntimeError('AGENT_NOT_READY', '执行尚未完成初始化。');
        return await execution.options.resolved.streamFn(model, context, {
          ...options,
          signal,
          maxTokens: Math.min(options?.maxTokens ?? model.maxTokens, outputTokens(model.maxTokens)),
        });
      } catch (error) {
        node.error = error;
        return failedStream(model, error, signal, failures);
      }
    },
    trackRequest(completion) {
      node.requests.add(completion);
      const settled = (): void => {
        node.requests.delete(completion);
      };
      void completion.then(settled, settled);
    },
    outputTokens,
    failure: (message) => failures.get(message),
    incoming: () =>
      owner.messaging.incoming(node).map((input) => {
        const message = communicationMessage(input);
        return {
          message,
          taskQuery: input.text,
          consume() {
            const at = Date.now();
            const view: MessageView = {
              id: randomUUID(),
              sessionId: node.session.id,
              branchId: node.run.branchId,
              runId: node.run.id,
              role: 'user',
              agentMessageId: input.id,
              text: input.text,
              thinking: '',
              createdAt: at,
              status: 'complete',
              stopReason: null,
            };
            const current = owner.messaging.incoming(node).find((entry) => entry.id === input.id);
            if (!current)
              throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '通信已经被消费或目标执行已结束。');
            return [
              {
                type: 'task.message_consumed',
                runId: node.run.id,
                at,
                data: { messageId: input.id, consumedRunId: node.run.id },
              },
              {
                type: 'message.started',
                runId: node.run.id,
                at,
                data: view,
                privateData: encodeContextMessage(message),
              },
            ];
          },
        };
      }),
    async finish(cancel) {
      await Promise.all(node.requests);
      await owner.finish(node, cancel);
    },
    cancel: (reason) => owner.cancelSubtree(node, reason),
    fault: (error) => owner.failTree(node, error),
  };
}
