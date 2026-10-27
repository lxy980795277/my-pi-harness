import { randomUUID } from 'node:crypto';
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, UserMessage } from '@earendil-works/pi-ai';
import type {
  MessageView,
  QueueInput,
  RunView,
  SessionSummary,
  ToolCallRecord,
} from '@my-pi-harness/protocol';
import { encodeContextMessage, encodeToolResult } from '../context/codec.js';
import { RuntimeError } from '../errors.js';
import type { ResolvedModel } from '../models/gateway.js';
import type { EventInput } from '../sessions/ports.js';
import { toolCallRecordId, type ToolRuntime } from '../tools/runtime.js';
import type { WorkRuntime } from '../work/runtime.js';
import { userWithAttachments } from '../context/attachments.js';
import type { RunToolset } from '../tools/toolset.js';
import { messageUsage } from './message-usage.js';
import type { ExternalTools } from '../tools/external.js';
import { StoredToolIntentSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import type { ToolRunContext } from '../tools/types.js';
import type { RunCapabilities } from '../capabilities/run.js';
import type { FrozenInputCapabilities } from '../capabilities/inputs.js';
import { activeSkillContext } from '../capabilities/context.js';

interface RunExecutionOptions {
  session: SessionSummary;
  run: RunView;
  resolved: ResolvedModel;
  history: Message[];
  user: UserMessage;
  systemPrompt: string;
  basePrompt: string;
  eligibleInputIds: readonly string[];
  toolset: RunToolset;
  capabilities?: RunCapabilities;
  acceptedCapabilities?: FrozenInputCapabilities;
  commit(events: readonly EventInput[]): void;
  queue(): QueueInput[];
  onError(error: unknown): void;
  tools?: ToolRuntime;
  work?: WorkRuntime;
  externalTools?: ExternalTools;
}

function validToolIntents(message: AssistantMessage): boolean {
  if (message.content.length > 1024) return false;
  const ids = new Set<string>();
  for (const part of message.content) {
    if (part.type !== 'toolCall') continue;
    if (
      !Value.Check(StoredToolIntentSchema, part) ||
      ids.has(part.id) ||
      !Value.Check(Type.Record(Type.String(), Type.Unknown()), part.arguments)
    )
      return false;
    ids.add(part.id);
  }
  return true;
}

/** One SDK run; event subscribers never wait for this owner's idle promise. */
export class RunExecution {
  public readonly agent: Agent;
  public task: Promise<void> = Promise.resolve();
  public cancelled = false;
  public persistenceFailed = false;
  public outcome: RunView['status'] = 'running';
  private current: MessageView | undefined;
  private final: AssistantMessage | undefined;
  private failure: unknown;
  private readonly queuedMessages = new WeakMap<UserMessage, QueueInput>();
  private readonly unsubscribe: () => void;
  private readonly eligible: Set<string>;
  private started = false;
  private readonly toolAbort = new AbortController();
  private lastAssistantMessageId: string | undefined;
  private turns = 0;
  private unknownOutcome = false;
  private discardedAssistantCalls = false;
  private readonly recordedTools = new Set<string>();
  private readonly declaredCalls = new Map<
    string,
    {
      assistantId: string;
      providerCallId: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  >();

  public constructor(public readonly options: RunExecutionOptions) {
    this.eligible = new Set(options.eligibleInputIds);
    let tools: ReturnType<ToolRuntime['createTools']> = [];
    let toolContext: ToolRunContext | undefined;
    if (options.tools) {
      toolContext = {
        session: options.session,
        run: options.run,
        signal: this.toolAbort.signal,
        supportsImages: options.resolved.model.input.includes('image'),
        recorded: this.recordedTools,
        assistantMessageId: () => {
          if (!this.lastAssistantMessageId)
            throw new RuntimeError('STREAM_PROTOCOL', 'Tool request has no assistant call');
          return this.lastAssistantMessageId;
        },
        commit: (events) => this.commit(events),
        persistenceFailure: (error): never => this.failPersistence(error),
        stopAfterTool: (reason): void => this.cancel(reason),
        ...(options.capabilities ? { controls: options.capabilities } : {}),
        outcomeUnknown: (message): void => {
          this.unknownOutcome = true;
          this.failure = new RuntimeError('TOOL_OUTCOME_UNKNOWN', message);
          this.agent.clearAllQueues();
          this.toolAbort.abort(this.failure);
          this.agent.abort();
        },
      };
      tools = options.tools.createTools(toolContext, options.toolset);
    }
    this.agent = new Agent({
      initialState: {
        messages: options.history,
        model: options.resolved.model,
        tools,
        thinkingLevel: options.session.thinkingLevel,
        systemPrompt: options.systemPrompt,
      },
      streamFn: async (model, context, streamOptions) => {
        if (this.unknownOutcome) throw this.failure;
        await options.capabilities?.validate(this.toolAbort.signal);
        const external = this.toolset().records.flatMap((record) =>
          record.external ? [record.external] : [],
        );
        if (external.length > 0) {
          if (!options.externalTools) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
          await options.externalTools.validateBindings(external, this.toolAbort.signal);
        }
        options.capabilities?.assertCurrent();
        if (external.length > 0) options.externalTools?.assertBindingsCurrent(external);
        return await options.resolved.streamFn(model, context, streamOptions);
      },
      sessionId: options.session.id,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      toolExecution: 'sequential',
      prepareRequest: ({ context }) => {
        if (this.unknownOutcome) throw this.failure;
        let advanced = false;
        try {
          advanced = options.capabilities?.advance() ?? false;
        } catch (error) {
          if (error instanceof RuntimeError && error.code === 'CAPABILITY_PERSISTENCE_FAILED')
            this.failPersistence(error);
          this.failure = error;
          this.toolAbort.abort(error);
          this.agent.clearAllQueues();
          this.agent.abort();
          throw error;
        }
        if (!advanced) return undefined;
        if (!options.tools || !toolContext)
          throw new RuntimeError('TOOL_NOT_AVAILABLE', '工具运行时不可用。');
        tools = options.tools.createTools(toolContext, this.toolset());
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
                      toolsAdded: [...this.toolset().definitions],
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
              if (this.unknownOutcome) throw this.failure;
              const work = options.work;
              if (!work) return messages;
              try {
                return await work.context.project({
                  session: options.session,
                  run: options.run,
                  resolved: options.resolved,
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
                  toolDefinitions: this.toolset().definitions,
                  capabilityRevision: options.capabilities?.revision ?? 1,
                  skills: options.capabilities?.skills() ?? [],
                  signal: signal
                    ? AbortSignal.any([signal, this.toolAbort.signal])
                    : this.toolAbort.signal,
                });
              } catch (error) {
                this.failure = error;
                throw error;
              }
            },
          }
        : {}),
      finishTurn: ({ message }) => {
        if (this.unknownOutcome) return { action: 'end' };
        this.turns += 1;
        if (this.turns >= 32) {
          this.failure = new RuntimeError('TURN_LIMIT', '工具循环达到本次运行的轮数上限。');
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
    this.unsubscribe = this.agent.subscribe((event) => {
      try {
        this.receive(event);
      } catch (error) {
        this.failPersistence(error);
      }
    });
  }

  public start(): Promise<void> {
    this.started = true;
    this.task = this.execute();
    return this.task;
  }

  public cancel(reason: string): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.toolAbort.abort(new RuntimeError('RUN_CANCELLED', '运行已停止。'));
    if (this.outcome !== 'running') {
      this.agent.clearAllQueues();
      return;
    }
    this.commit([
      {
        type: 'run.cancel_requested',
        runId: this.options.run.id,
        at: Date.now(),
        data: { reason },
      },
    ]);
    this.agent.clearAllQueues();
    this.agent.abort();
  }

  public rebuildQueue(): void {
    this.agent.clearAllQueues();
    if (this.unknownOutcome) return;
    for (const input of this.options.queue()) {
      if (!this.eligible.has(input.id)) continue;
      const message: UserMessage = this.options.work
        ? userWithAttachments(
            this.options.work.options.store,
            input,
            input.createdAt,
            this.options.resolved.model.input.includes('image'),
          )
        : {
            role: 'user',
            content: input.text,
            timestamp: input.createdAt,
          };
      this.queuedMessages.set(message, input);
      if (input.mode === 'steer') this.agent.steer(message);
      else this.agent.followUp(message);
    }
  }

  public allowQueue(inputId: string): void {
    this.eligible.add(inputId);
  }
  public eligibleQueueIds(): readonly string[] {
    return [...this.eligible];
  }

  /** Release an accepted run that failed before its first SDK request. */
  public disposeUnstarted(): void {
    if (this.started)
      throw new RuntimeError('RUN_ALREADY_STARTED', 'Started runs must settle through their owner');
    this.unsubscribe();
    this.options.work?.context.release(this.options.run.id);
    this.options.capabilities?.close();
    this.toolAbort.abort();
    this.agent.clearAllQueues();
    this.agent.abort();
  }

  private async execute(): Promise<void> {
    try {
      await this.agent.prompt(this.options.user);
      await this.agent.waitForIdle();
    } catch (error) {
      this.failure = error;
      this.options.onError(error);
    } finally {
      this.unsubscribe();
      this.options.work?.context.release(this.options.run.id);
      this.options.capabilities?.close();
      this.agent.clearAllQueues();
    }
    if (this.persistenceFailed) return;
    this.recordUnstartedCalls();
    const reason = this.final?.stopReason;
    this.outcome = this.cancelled
      ? 'cancelled'
      : !this.failure && (reason === 'stop' || reason === 'length')
        ? 'completed'
        : 'failed';
    if (this.current) {
      this.current.status = this.outcome === 'cancelled' ? 'cancelled' : 'failed';
      const at = Date.now();
      this.current.finishedAt = at;
      this.commit([
        {
          type: 'message.completed',
          runId: this.options.run.id,
          at,
          data: { message: this.current },
        },
      ]);
      this.current = undefined;
    }
    this.commit([
      {
        type: 'run.finished',
        runId: this.options.run.id,
        at: Date.now(),
        data: {
          status: this.outcome,
          finishedAt: Date.now(),
          error:
            this.outcome === 'failed'
              ? this.failure instanceof RuntimeError
                ? this.failure.message
                : 'The model request did not complete.'
              : null,
        },
      },
    ]);
  }

  private receive(event: AgentEvent): void {
    if (this.persistenceFailed) return;
    switch (event.type) {
      case 'message_start': {
        if (event.message.role === 'user') {
          const input = this.queuedMessages.get(event.message);
          if (input) this.consumeInput(input, event.message);
        } else if (event.message.role === 'assistant') {
          this.discardedAssistantCalls = false;
          if (this.current) {
            this.current.status = 'failed';
            const at = Date.now();
            this.current.finishedAt = at;
            this.commit([
              {
                type: 'message.completed',
                runId: this.options.run.id,
                at,
                data: { message: this.current },
              },
            ]);
          }
          this.current = {
            id: randomUUID(),
            sessionId: this.options.session.id,
            branchId: this.options.run.branchId,
            runId: this.options.run.id,
            role: 'assistant',
            text: '',
            thinking: '',
            createdAt: event.message.timestamp,
            status: 'streaming',
            stopReason: null,
          };
          this.commit([
            {
              type: 'message.started',
              runId: this.options.run.id,
              at: Date.now(),
              data: this.current,
            },
          ]);
        }
        break;
      }
      case 'message_update': {
        if (!this.current)
          throw new RuntimeError('STREAM_PROTOCOL', 'Model update has no active message');
        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta' || update.type === 'thinking_delta') {
          const field = update.type === 'text_delta' ? 'text' : 'thinking';
          const next = this.current[field] + update.delta;
          if (next.length > 2_000_000) {
            this.failure = new RuntimeError(
              'RESPONSE_LIMIT',
              'Model response exceeded the configured limit',
            );
            this.agent.abort();
            throw this.failure;
          }
          this.current[field] = next;
          this.commit([
            {
              type: 'message.delta',
              runId: this.options.run.id,
              at: Date.now(),
              data: { messageId: this.current.id, [field]: update.delta },
            },
          ]);
        }
        break;
      }
      case 'message_end': {
        if (event.message.role === 'toolResult') {
          if (this.discardedAssistantCalls) break;
          const resultMessage = event.message;
          if (!this.lastAssistantMessageId)
            throw new RuntimeError('STREAM_PROTOCOL', 'Tool result has no assistant call');
          const toolId = toolCallRecordId(
            this.options.run.id,
            this.lastAssistantMessageId,
            resultMessage.toolCallId,
          );
          if (this.recordedTools.has(toolId)) break;
          const call = this.final?.content.find(
            (part) => part.type === 'toolCall' && part.id === resultMessage.toolCallId,
          );
          let argumentsPreview: Record<string, unknown> = {};
          if (call?.type === 'toolCall' && JSON.stringify(call.arguments).length <= 256_000)
            argumentsPreview = call.arguments;
          const at = Date.now();
          const tool: ToolCallRecord = {
            id: toolId,
            sessionId: this.options.session.id,
            runId: this.options.run.id,
            branchId: this.options.run.branchId,
            name: resultMessage.toolName.slice(0, 100) || 'unknown_tool',
            arguments: argumentsPreview,
            status: 'failed',
            binding: { kind: 'rejected', reason: '工具请求未通过执行前校验' },
            dispatch: { state: 'not_applicable' },
            summary: '工具请求未通过执行前校验',
            result: resultMessage.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
              .slice(0, 128_000),
            diff: null,
            createdAt: at,
            updatedAt: at,
          };
          this.commit([
            { type: 'tool.requested', runId: this.options.run.id, at, data: { tool } },
            {
              type: 'tool.context',
              runId: this.options.run.id,
              at,
              data: {
                branchId: this.options.run.branchId,
                afterMessageId: this.lastAssistantMessageId,
                toolCallId: toolId,
              },
              privateData: encodeToolResult({
                toolResultVersion: 1,
                providerCallId: resultMessage.toolCallId,
                toolName: resultMessage.toolName,
                content: resultMessage.content,
                isError: true,
                at,
                outcome: 'failed',
                origin: 'host',
              }),
            },
          ]);
          this.recordedTools.add(toolId);
          break;
        }
        if (event.message.role !== 'assistant') break;
        this.final = event.message;
        if (!this.current)
          throw new RuntimeError('STREAM_PROTOCOL', 'Final model response has no active message');
        let status: MessageView['status'] =
          this.cancelled || event.message.stopReason === 'aborted'
            ? 'cancelled'
            : event.message.stopReason === 'stop' ||
                event.message.stopReason === 'length' ||
                event.message.stopReason === 'toolUse'
              ? 'complete'
              : 'failed';
        if (status === 'complete' && !validToolIntents(event.message)) {
          status = 'failed';
          this.discardedAssistantCalls = true;
          this.failure = new RuntimeError(
            'MODEL_TOOL_INTENT_INVALID',
            '模型返回的工具调用标识或参数格式无效。',
          );
          this.toolAbort.abort(this.failure);
          this.agent.clearAllQueues();
          this.agent.abort();
        }
        const text = event.message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('');
        const thinking = event.message.content
          .filter((part) => part.type === 'thinking')
          .map((part) => part.thinking)
          .join('');
        if (text.length > 2_000_000 || thinking.length > 2_000_000) {
          this.failure = new RuntimeError(
            'RESPONSE_LIMIT',
            'Model response exceeded the configured limit',
          );
          this.agent.abort();
          throw this.failure;
        }
        const at = Date.now();
        const usage = messageUsage(event.message.usage);
        this.current = {
          ...this.current,
          text,
          thinking,
          status,
          stopReason: event.message.stopReason,
          finishedAt: at,
          ...(usage ? { usage } : {}),
        };
        this.commit([
          {
            type: 'message.completed',
            runId: this.options.run.id,
            at,
            data: { message: this.current },
            ...(status === 'complete' ? { privateData: encodeContextMessage(event.message) } : {}),
          },
        ]);
        this.lastAssistantMessageId = this.current.id;
        for (const call of event.message.content) {
          if (
            status !== 'complete' ||
            (event.message.stopReason !== 'toolUse' && event.message.stopReason !== 'length')
          )
            break;
          if (call.type !== 'toolCall') continue;
          const id = toolCallRecordId(this.options.run.id, this.current.id, call.id);
          this.declaredCalls.set(id, {
            assistantId: this.current.id,
            providerCallId: call.id,
            name: call.name,
            arguments: call.arguments,
          });
        }
        this.current = undefined;
        break;
      }
      default:
        break;
    }
  }

  /** Pair declared calls that the sequential SDK never entered before termination. */
  private recordUnstartedCalls(): void {
    for (const [id, call] of this.declaredCalls) {
      if (this.recordedTools.has(id)) continue;
      const at = Date.now();
      const text = '宿主记录：本次运行结束前未派发此调用。';
      const args = JSON.stringify(call.arguments).length <= 256_000 ? call.arguments : {};
      const tool: ToolCallRecord = {
        id,
        sessionId: this.options.session.id,
        runId: this.options.run.id,
        branchId: this.options.run.branchId,
        name: call.name.slice(0, 100),
        arguments: args,
        status: 'interrupted',
        binding: { kind: 'rejected', reason: text },
        dispatch: { state: 'not_applicable' },
        summary: text,
        result: text,
        diff: null,
        createdAt: at,
        updatedAt: at,
      };
      this.commit([
        {
          type: 'tool.requested',
          runId: this.options.run.id,
          at,
          data: { tool, afterMessageId: call.assistantId },
        },
        {
          type: 'tool.context',
          runId: this.options.run.id,
          at,
          data: {
            toolCallId: id,
            branchId: this.options.run.branchId,
            afterMessageId: call.assistantId,
          },
          privateData: encodeToolResult({
            toolResultVersion: 1,
            providerCallId: call.providerCallId,
            toolName: call.name,
            content: [{ type: 'text', text }],
            isError: true,
            at,
            outcome: 'interrupted',
            origin: 'host',
          }),
        },
      ]);
      this.recordedTools.add(id);
    }
  }

  private consumeInput(input: QueueInput, message: UserMessage): void {
    if (this.unknownOutcome) throw this.failure;
    const external = this.toolset().records.flatMap((record) =>
      record.external ? [record.external] : [],
    );
    try {
      if (external.length > 0) {
        if (!this.options.externalTools) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
        this.options.externalTools.assertBindingsCurrent(external);
      }
      this.options.capabilities?.assertCurrent();
    } catch (cause) {
      this.failure = new RuntimeError(
        'INPUT_AUTHORITY_REVOKED',
        '排队输入的授权已失效，消息已保留。',
        { cause },
      );
      this.toolAbort.abort(this.failure);
      this.agent.clearAllQueues();
      this.agent.abort();
      return;
    }
    const current = this.options.queue().find(({ id }) => id === input.id);
    if (!current || current.revision !== input.revision)
      throw new RuntimeError('QUEUE_SELECTED', 'Queued input changed while being selected');
    const view: MessageView = {
      id: randomUUID(),
      sessionId: this.options.session.id,
      branchId: this.options.run.branchId,
      runId: this.options.run.id,
      role: 'user',
      text: input.text,
      ...(input.attachmentIds ? { attachmentIds: input.attachmentIds } : {}),
      mcpTools: input.mcpTools ?? [],
      skills: input.skills ?? [],
      thinking: '',
      createdAt: Date.now(),
      status: 'complete',
      stopReason: null,
    };
    this.commit([
      {
        type: 'queue.consumed',
        runId: this.options.run.id,
        at: Date.now(),
        data: { inputId: input.id },
      },
      {
        type: 'message.started',
        runId: this.options.run.id,
        at: Date.now(),
        data: view,
        privateData: encodeContextMessage(message),
      },
    ]);
  }

  private commit(events: readonly EventInput[]): void {
    try {
      this.options.commit(events);
    } catch (error) {
      this.failPersistence(error);
    }
  }

  private toolset(): RunToolset {
    return this.options.capabilities?.active ?? this.options.toolset;
  }

  private failPersistence(error: unknown): never {
    if (!this.persistenceFailed) {
      this.persistenceFailed = true;
      this.toolAbort.abort(error);
      this.failure = error;
      this.agent.clearAllQueues();
      this.agent.abort();
      this.options.onError(error);
    }
    throw error;
  }
}
