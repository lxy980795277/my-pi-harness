import { Agent } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { activeSkillContext } from '../capabilities/context';
import { RuntimeError } from '../errors';
import type { ToolRuntime } from '../tools/runtime';
import type { ToolRunContext } from '../tools/types';
import type { RunToolset } from '../tools/toolset';
import type { RunAgentHost, RunExecutionOptions } from './types';
import type { RunHooks } from './ports';
import { runMemoryRequest, runMemoryMutationContext, memoryToolHandlers } from './memory';
import { dispatchRequest, scheduledStream } from './request';
import type { PreparedContext } from '../context/request-context';
import { fitContext } from '../context/budget';
import { encodeContextMessage } from '../context/codec';
import { memoryPrompt } from '../context/memory';
import type { ResolvedModel } from '../models/gateway';

/** Current definitions advance only through the capability owner's durable visibility barrier. */
export function currentToolset(options: RunExecutionOptions): RunToolset {
  return options.capabilities?.active ?? options.toolset;
}

/** Queued input is consumed only while its accepted external authority remains current. */
export function assertQueuedAuthority(options: RunExecutionOptions): void {
  const external = currentToolset(options).records.flatMap((record) =>
    record.external ? [record.external] : [],
  );
  if (external.length > 0) {
    if (!options.externalTools) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
    options.externalTools.assertBindingsCurrent(external);
  }
  options.capabilities?.assertCurrent();
}

/** Context budgeting uses the output policy and stream effective for this request. */
function resolveProjectionModel(
  resolved: ResolvedModel,
  hooks: RunHooks | undefined,
): ResolvedModel {
  if (!hooks) return resolved;
  return {
    ...resolved,
    model: {
      ...resolved.model,
      maxTokens: hooks.outputTokens(resolved.model.maxTokens),
    },
    streamFn: scheduledStream(hooks.stream, hooks, () => undefined),
  };
}

/** Assemble Pi, tool dispatch and request hooks without owning the Run's terminal outcome. */
export function createRunAgent(options: RunExecutionOptions, host: RunAgentHost): Agent {
  let tools: ReturnType<ToolRuntime['createTools']> = [];
  let toolContext: ToolRunContext | undefined;
  let requestDraft: PreparedContext | undefined;
  let sourceMessages: Message[] = [];
  const identity = () => runMemoryRequest(options, host.memoryQuery(), host.signal);
  const mutationIdentity = () =>
    runMemoryMutationContext(options, host.memorySource(), host.signal);
  const modelStream = scheduledStream(
    options.hooks?.stream ?? options.resolved.streamFn,
    options.hooks,
    (error) => options.onError(error),
  );
  if (options.tools) {
    toolContext = {
      session: options.session,
      run: options.run,
      readOnly: options.session.approvalMode === 'read-only' || options.hooks?.readOnly === true,
      signal: host.signal,
      supportsImages: options.resolved.model.input.includes('image'),
      recorded: host.recorded,
      assistantMessageId: () => host.assistantMessageId(),
      argumentsError: (input) => {
        for (let index = agent.state.messages.length - 1; index >= 0; index -= 1) {
          const message = agent.state.messages[index];
          if (message?.role !== 'assistant') continue;
          const call = message.content.find(
            (part) => part.type === 'toolCall' && part.arguments === input,
          );
          return call?.type === 'toolCall' ? call.argumentsError : undefined;
        }
        return undefined;
      },
      commit: (events) => host.commit(events),
      persistenceFailure: (error): never => host.failPersistence(error),
      outcomeUnknown: (message) => host.outcomeUnknown(message),
      ...(options.capabilities ? { controls: options.capabilities } : {}),
      ...(host.searchTools ? { search: host.searchTools } : {}),
      ...(options.memory
        ? { memory: memoryToolHandlers(options.memory, identity, mutationIdentity) }
        : {}),
      ...(options.hooks
        ? {
            agents: options.hooks.controls,
            beforeTool: options.hooks.beforeTool,
            modelStream,
          }
        : {}),
    };
    tools = options.tools.createTools(toolContext, options.toolset);
  }
  const agent = new Agent({
    initialState: {
      messages: options.history,
      model: options.resolved.model,
      tools,
      thinkingLevel: options.session.thinkingLevel,
      systemPrompt: options.systemPrompt,
    },
    streamFn: async (model, context, streamOptions) => {
      try {
        return await dispatchRequest({
          identity: identity(),
          ...(options.hooks ? { hooks: options.hooks } : {}),
          ...(options.memory ? { memory: options.memory } : {}),
          draft: () => {
            if (!requestDraft) throw new RuntimeError('CONTEXT_NOT_READY', '请求上下文尚未准备。');
            return requestDraft;
          },
          prepare: () => prepare(sourceMessages, host.signal),
          validate: async () => {
            host.assertKnownOutcome();
            await options.capabilities?.validate(host.signal);
            const external = currentToolset(options).records.flatMap((record) =>
              record.external ? [record.external] : [],
            );
            if (external.length > 0) {
              if (!options.externalTools) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
              await options.externalTools.validateBindings(external, host.signal);
            }
            assertQueuedAuthority(options);
          },
          stream: options.hooks?.stream ?? options.resolved.streamFn,
          onError: (error) => options.onError(error),
        })(model, context, streamOptions);
      } catch (error) {
        host.rememberFailure(error);
        throw error;
      }
    },
    sessionId: options.run.taskId ?? options.session.id,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'sequential',
    prepareRequest: async ({ context }, signal) => {
      sourceMessages = context.messages;
      try {
        await prepare(
          sourceMessages,
          signal ? AbortSignal.any([signal, host.signal]) : host.signal,
        );
      } catch (error) {
        host.rememberFailure(error);
        throw error;
      }
      return { context: { ...context, tools } };
    },
    // Pi retains its original transcript; only the provider input uses the finalized projection.
    transformContext: (messages: Message[]) => Promise.resolve(requestDraft?.messages ?? messages),
    finishTurn: ({ message }) => {
      if (host.isOutcomeUnknown()) return { action: 'end' };
      if (
        (tools.length === 0 && message.stopReason === 'toolUse') ||
        message.stopReason === 'deferred'
      )
        return { action: 'end' };
      return undefined;
    },
  });
  async function prepare(messages: Message[], signal: AbortSignal): Promise<void> {
    host.assertKnownOutcome();
    host.assertSearchQuotes?.();
    await options.capabilities?.prepareResources(signal);
    const resolveTools = (requirements: readonly string[]) => {
      try {
        options.capabilities?.ensure(requirements);
        if (options.capabilities?.advance()) {
          if (!options.tools || !toolContext)
            throw new RuntimeError('TOOL_NOT_AVAILABLE', '工具运行时不可用。');
          tools = options.tools.createTools(toolContext, currentToolset(options));
          agent.state.tools = tools;
        }
      } catch (error) {
        if (error instanceof RuntimeError && error.code === 'CAPABILITY_PERSISTENCE_FAILED')
          host.failPersistence(error);
        host.fail(error);
        throw error;
      }
      return {
        toolDefinitions: currentToolset(options).definitions,
        capabilityRevision: options.capabilities?.revision ?? 1,
        skills: options.capabilities?.skills() ?? [],
      };
    };
    const memory = await options.memory?.readSnapshot({ ...identity(), signal });
    signal.throwIfAborted();
    const work = options.work;
    if (work) {
      const projection = await work.context.project({
        session: options.session,
        run: options.run,
        resolved: resolveProjectionModel(options.resolved, options.hooks),
        messages,
        basePrompt: options.basePrompt,
        currentTask: host.currentTask(),
        toolDefinitions: currentToolset(options).definitions,
        capabilityRevision: options.capabilities?.revision ?? 1,
        skills: options.capabilities?.skills() ?? [],
        canUseTool: (name) =>
          options.capabilities?.canProvide(name) ??
          currentToolset(options).definitions.some((definition) => definition.name === name),
        resolveTools,
        signal,
        ...(memory ? { memory } : {}),
      });
      requestDraft = {
        ...projection,
        isCurrent: () => {
          host.assertSearchQuotes?.();
          return projection.isCurrent();
        },
        commit: () => {
          try {
            projection.commit();
          } catch (error) {
            host.failPersistence(error);
          }
        },
      };
      return;
    }
    const definitions = resolveTools([]);
    const base = [options.basePrompt, activeSkillContext(definitions.skills)]
      .filter(Boolean)
      .join('\n\n');
    const output =
      options.hooks?.outputTokens(options.resolved.model.maxTokens) ??
      options.resolved.model.maxTokens;
    const adopted = memoryPrompt(base, memory, options.resolved.model.contextWindow - output);
    const prompt = adopted.prompt;
    const projected = fitContext({
      messages: messages.filter((message) => message.role !== 'system'),
      systemPrompt: prompt,
      contextWindow: options.resolved.model.contextWindow,
      maxOutput:
        options.hooks?.outputTokens(options.resolved.model.maxTokens) ??
        options.resolved.model.maxTokens,
      toolDefinitions: definitions.toolDefinitions,
    });
    projected.usage.categories.system -= adopted.tokens;
    projected.usage.categories.memory = adopted.tokens;
    const projectedMessages: Message[] = [
      {
        role: 'system',
        content: prompt,
        timestamp: Date.now(),
        toolsAdded: [...definitions.toolDefinitions],
      },
      ...projected.messages,
    ];
    requestDraft = {
      ...(adopted.snapshot ? { memory: adopted.snapshot } : {}),
      messages: projectedMessages,
      isCurrent: () => {
        host.assertSearchQuotes?.();
        return true;
      },
      commit: () => {
        host.commit([
          {
            type: 'context.prepared',
            runId: options.run.id,
            at: Date.now(),
            data: {
              branchId: options.run.branchId,
              ...(options.run.taskId ? { taskId: options.run.taskId } : {}),
              usage: projected.usage,
              messageIds: [],
              capabilityRevision: definitions.capabilityRevision,
            },
            privateData: {
              version: 1,
              systemPrompt: prompt,
              messages: projectedMessages.map((message) => encodeContextMessage(message)),
              ...(adopted.range ? { memoryRange: adopted.range } : {}),
              ...(adopted.snapshot?.selection
                ? { memorySelection: adopted.snapshot.selection }
                : {}),
            },
          },
        ]);
      },
    };
  }
  return agent;
}
