import type { MemoryToolHandlers, ToolInvocation } from '@my-pi-harness/tools';
import { createHash } from 'node:crypto';
import type {
  MessageView,
  MemoryMessageSource,
  MemoryMutationResult,
} from '@my-pi-harness/protocol';
import type { RunMemoryPort, RunMemoryRequest, RunMemoryMutationContext } from './ports';
import type { RunExecutionOptions } from './types';
import { RuntimeError } from '../errors';

/** Only consumed direct human text supplies mutation provenance; attachments and task messages do not. */
export function consumedMemorySource(message: MessageView): MemoryMessageSource | undefined {
  if (message.role !== 'user' || message.agentMessageId !== undefined || !message.text.trim())
    return undefined;
  return {
    kind: 'message',
    sessionId: message.sessionId,
    branchId: message.branchId,
    messageId: message.id,
    contentHash: createHash('sha256').update(message.text).digest('hex'),
  };
}

export function runMemoryMutationContext(
  options: Pick<RunExecutionOptions, 'session' | 'run'>,
  source: MemoryMessageSource | undefined,
  signal: AbortSignal,
): RunMemoryMutationContext {
  return {
    sessionId: options.session.id,
    branchId: options.run.branchId,
    runId: options.run.id,
    signal,
    ...(!options.run.taskId && source ? { source } : {}),
  };
}

/** The actual Run supplies scope and transferred references; a tool can supply only its query. */
export function runMemoryRequest(
  options: Pick<RunExecutionOptions, 'session' | 'run' | 'userMemoryIds'>,
  query: string,
  signal: AbortSignal,
): RunMemoryRequest {
  return {
    sessionId: options.session.id,
    workspaceId: options.session.workspaceId,
    query,
    signal,
    ...(options.run.taskId
      ? { taskId: options.run.taskId, userMemoryIds: options.userMemoryIds ?? [] }
      : {}),
  };
}

/** A fixed-memory-only host does not implicitly expose an unbound search operation. */
export function canSearchMemories(
  port: RunMemoryPort | undefined,
  input: RunMemoryRequest,
): boolean {
  return port?.searchMemories !== undefined && port.canUse?.(input) === true;
}

/** Execution checks settings, source facts and logged tool intent in the host domain. */
export function memoryToolHandlers(
  port: RunMemoryPort,
  input: () => RunMemoryRequest,
  mutation: () => RunMemoryMutationContext,
): MemoryToolHandlers {
  async function mutate<T>(
    operation:
      | ((
          context: RunMemoryMutationContext,
          value: T,
          toolCallId: string,
        ) => Promise<MemoryMutationResult>)
      | undefined,
    value: T,
    invocation: ToolInvocation,
  ): Promise<MemoryMutationResult> {
    const context = mutation();
    if (!operation) throw new RuntimeError('MEMORY_UNAVAILABLE', '当前服务未提供此记忆操作。');
    if (!context.source)
      throw new RuntimeError('MEMORY_SOURCE_REQUIRED', '记忆操作缺少已消费的人类输入来源。');
    const signal = AbortSignal.any([context.signal, invocation.signal]);
    signal.throwIfAborted();
    const result = await operation({ ...context, signal }, value, invocation.toolCallId);
    signal.throwIfAborted();
    return result;
  }
  return {
    save: (value, invocation) => mutate(port.saveMemory?.bind(port), value, invocation),
    learn: (value, invocation) => mutate(port.learnMemory?.bind(port), value, invocation),
    update: (value, invocation) => mutate(port.updateMemory?.bind(port), value, invocation),
    delete: (value, invocation) => mutate(port.deleteMemory?.bind(port), value, invocation),
    async search(query, limit, signal) {
      const identity = input();
      const combined = AbortSignal.any([identity.signal, signal]);
      combined.throwIfAborted();
      const request = { ...identity, signal: combined };
      if (!port.searchMemories || !canSearchMemories(port, request))
        throw new RuntimeError('MEMORY_UNAVAILABLE', '当前执行未获准读取记忆。');
      const result = await port.searchMemories(request, query, limit);
      combined.throwIfAborted();
      if (!canSearchMemories(port, request))
        throw new RuntimeError('MEMORY_UNAVAILABLE', '记忆读取权限已变更。');
      return result;
    },
  };
}
