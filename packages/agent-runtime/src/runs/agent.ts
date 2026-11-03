import { Agent } from '@earendil-works/pi-agent-core';
import type { Message, UserMessage } from '@earendil-works/pi-ai';
import { activeSkillContext } from '../capabilities/context.js';
import { RuntimeError } from '../errors.js';
import type { ToolRuntime } from '../tools/runtime.js';
import type { ToolRunContext } from '../tools/types.js';
import type { RunToolset } from '../tools/toolset.js';
import type { RunAgentHost, RunExecutionOptions } from './types.js';
import type { RunHooks } from './ports.js';
import type { ResolvedModel } from '../models/gateway.js';

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
    streamFn: hooks.stream,
  };
}

function currentTaskText(user: UserMessage): string {
  if (typeof user.content === 'string') return user.content;
  const text = user.content.find((part) => part.type === 'text');
  return text?.text ?? '';
}

/** Assemble Pi, tool dispatch and request hooks without owning the Run's terminal outcome. */
export function createRunAgent(options: RunExecutionOptions, host: RunAgentHost): Agent {
  let tools: ReturnType<ToolRuntime['createTools']> = [];
  let toolContext: ToolRunContext | undefined;
  let requestMessages: Message[] | undefined;
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
      ...(options.hooks
        ? {
            agents: options.hooks.controls,
            beforeTool: options.hooks.beforeTool,
            modelStream: options.hooks.stream,
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
      return await (options.hooks?.stream ?? options.resolved.streamFn)(
        model,
        context,
        streamOptions,
      );
    },
    sessionId: options.run.taskId ?? options.session.id,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'sequential',
    prepareRequest: async ({ context }, signal) => {
      host.assertKnownOutcome();
      let advanced = false;
      const resolveTools = (requirements: readonly string[]) => {
        try {
          options.capabilities?.ensure(requirements);
          if (options.capabilities?.advance()) {
            advanced = true;
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
      const work = options.work;
      if (work) {
        const resolved = resolveProjectionModel(options.resolved, options.hooks);
        try {
          requestMessages = await work.context.project({
            session: options.session,
            run: options.run,
            resolved,
            messages: context.messages,
            basePrompt: options.basePrompt,
            currentTask: currentTaskText(options.user),
            toolDefinitions: currentToolset(options).definitions,
            capabilityRevision: options.capabilities?.revision ?? 1,
            skills: options.capabilities?.skills() ?? [],
            canUseTool: (name) =>
              options.capabilities?.canProvide(name) ??
              currentToolset(options).definitions.some((definition) => definition.name === name),
            resolveTools,
            signal: signal ? AbortSignal.any([signal, host.signal]) : host.signal,
          });
        } catch (error) {
          host.rememberFailure(error);
          throw error;
        }
        return { context: { ...context, tools } };
      }
      resolveTools([]);
      if (!advanced) return undefined;
      return {
        context: {
          ...context,
          tools,
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
        },
      };
    },
    // Pi retains the original transcript; only the provider input uses the prepared projection.
    ...(options.work
      ? { transformContext: (messages: Message[]) => Promise.resolve(requestMessages ?? messages) }
      : {}),
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
  return agent;
}
