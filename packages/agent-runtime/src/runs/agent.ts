import { Agent } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { activeSkillContext } from '../capabilities/context.js';
import { RuntimeError } from '../errors.js';
import type { ToolRuntime } from '../tools/runtime.js';
import type { ToolRunContext } from '../tools/types.js';
import type { RunToolset } from '../tools/toolset.js';
import type { RunAgentHost, RunExecutionOptions } from './types.js';

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

/** Assemble Pi, tool dispatch and request hooks without owning the Run's terminal outcome. */
export function createRunAgent(options: RunExecutionOptions, host: RunAgentHost): Agent {
  let tools: ReturnType<ToolRuntime['createTools']> = [];
  let toolContext: ToolRunContext | undefined;
  let turns = 0;
  if (options.tools) {
    toolContext = {
      session: options.session,
      run: options.run,
      readOnly: options.session.approvalMode === 'read-only' || options.agents?.readOnly === true,
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
      stopAfterTool: (reason) => host.cancel(reason),
      outcomeUnknown: (message) => host.outcomeUnknown(message),
      ...(options.capabilities ? { controls: options.capabilities } : {}),
      ...(options.agents
        ? {
            agents: options.agents.controls,
            beforeTool: options.agents.beforeTool,
            modelStream: options.agents.stream,
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
      host.assertKnownOutcome();
      await options.capabilities?.validate(host.signal);
      const external = currentToolset(options).records.flatMap((record) =>
        record.external ? [record.external] : [],
      );
      if (external.length > 0) {
        if (!options.externalTools) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
        await options.externalTools.validateBindings(external, host.signal);
      }
      options.capabilities?.assertCurrent();
      if (external.length > 0) options.externalTools?.assertBindingsCurrent(external);
      return await (options.agents?.stream ?? options.resolved.streamFn)(
        model,
        context,
        streamOptions,
      );
    },
    sessionId: options.run.taskId ?? options.session.id,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'sequential',
    prepareRequest: ({ context }) => {
      host.assertKnownOutcome();
      let advanced = false;
      try {
        advanced = options.capabilities?.advance() ?? false;
      } catch (error) {
        if (error instanceof RuntimeError && error.code === 'CAPABILITY_PERSISTENCE_FAILED')
          host.failPersistence(error);
        host.fail(error);
        throw error;
      }
      if (!advanced) return undefined;
      if (!options.tools || !toolContext)
        throw new RuntimeError('TOOL_NOT_AVAILABLE', '工具运行时不可用。');
      tools = options.tools.createTools(toolContext, currentToolset(options));
      return {
        context: {
          ...context,
          tools,
          ...(!options.work
            ? {
                messages: [
                  {
                    role: 'system' as const,
                    content: [
                      options.basePrompt,
                      activeSkillContext(options.capabilities?.skills() ?? []),
                    ]
                      .filter(Boolean)
                      .join('\n\n'),
                    toolsAdded: [...currentToolset(options).definitions],
                    timestamp: Date.now(),
                  },
                  ...context.messages.filter((message) => message.role !== 'system'),
                ],
              }
            : {}),
        },
      };
    },
    ...(options.work
      ? {
          transformContext: async (
            messages: Message[],
            signal?: AbortSignal,
          ): Promise<Message[]> => {
            host.assertKnownOutcome();
            const work = options.work;
            if (!work) return messages;
            const resolved = options.agents
              ? {
                  ...options.resolved,
                  model: {
                    ...options.resolved.model,
                    maxTokens: options.agents.outputTokens(options.resolved.model.maxTokens),
                  },
                  streamFn: options.agents.stream,
                }
              : options.resolved;
            try {
              return await work.context.project({
                session: options.session,
                run: options.run,
                resolved,
                messages,
                basePrompt: options.basePrompt,
                currentTask:
                  typeof options.user.content === 'string'
                    ? options.user.content
                    : options.user.content
                        .filter((part) => part.type === 'text')
                        .slice(0, 1)
                        .map((part) => part.text)
                        .join(''),
                toolDefinitions: currentToolset(options).definitions,
                capabilityRevision: options.capabilities?.revision ?? 1,
                skills: options.capabilities?.skills() ?? [],
                signal: signal ? AbortSignal.any([signal, host.signal]) : host.signal,
              });
            } catch (error) {
              host.rememberFailure(error);
              throw error;
            }
          },
        }
      : {}),
    finishTurn: ({ message }) => {
      if (host.isOutcomeUnknown()) return { action: 'end' };
      turns += 1;
      if (
        turns >= (options.agents?.maxTurns ?? 32) &&
        message.stopReason !== 'stop' &&
        message.stopReason !== 'length' &&
        message.stopReason !== 'error' &&
        message.stopReason !== 'aborted'
      ) {
        host.rememberFailure(new RuntimeError('TURN_LIMIT', '工具循环达到本次运行的轮数上限。'));
        return { action: 'end' };
      }
      if (
        (tools.length === 0 && message.stopReason === 'toolUse') ||
        message.stopReason === 'deferred'
      )
        return { action: 'end' };
      return undefined;
    },
  });
  return agent;
}
