import { randomUUID } from 'node:crypto';
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, UserMessage } from '@earendil-works/pi-ai';
import type { MessageView, QueueInput, RunView, SessionSummary } from '@my-pi-harness/protocol';
import { encodeContextMessage } from './context-codec.js';
import { RuntimeError } from './errors.js';
import type { ResolvedModel } from './model-gateway.js';
import type { EventInput } from './runtime-ports.js';
import { toolCallRecordId, type ToolRuntime } from './tool-runtime.js';
import type { WorkRuntime } from './work-runtime.js';
import { userWithAttachments } from './attachment-context.js';
import type { RunToolset } from './run-toolset.js';
import { messageUsage } from './message-usage.js';

export interface RunExecutionOptions {
  session: SessionSummary;
  run: RunView;
  resolved: ResolvedModel;
  history: Message[];
  user: UserMessage;
  systemPrompt: string;
  basePrompt: string;
  eligibleInputIds: readonly string[];
  toolset: RunToolset;
  commit(events: readonly EventInput[]): void;
  queue(): QueueInput[];
  onError(error: unknown): void;
  tools?: ToolRuntime;
  work?: WorkRuntime;
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
  private readonly recordedTools = new Set<string>();

  public constructor(public readonly options: RunExecutionOptions) {
    this.eligible = new Set(options.eligibleInputIds);
    let tools: ReturnType<ToolRuntime['createTools']> = [];
    if (options.tools) {
      tools = options.tools.createTools(
        {
          session: options.session,
          run: options.run,
          signal: this.toolAbort.signal,
          recorded: this.recordedTools,
          assistantMessageId: () => {
            if (!this.lastAssistantMessageId)
              throw new RuntimeError('STREAM_PROTOCOL', 'Tool request has no assistant call');
            return this.lastAssistantMessageId;
          },
          commit: (events) => this.commit(events),
        },
        options.toolset,
      );
    }
    this.agent = new Agent({
      initialState: {
        messages: options.history,
        model: options.resolved.model,
        tools,
        thinkingLevel: options.session.thinkingLevel,
        systemPrompt: options.systemPrompt,
      },
      streamFn: options.resolved.streamFn,
      sessionId: options.session.id,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      toolExecution: 'sequential',
      ...(options.work
        ? {
            transformContext: async (
              messages: Message[],
              signal?: AbortSignal,
            ): Promise<Message[]> => {
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
                  toolDefinitions: options.toolset.definitions,
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
    this.unsubscribe = this.agent.subscribe((event) => this.receive(event));
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
      this.agent.clearAllQueues();
    }
    if (this.persistenceFailed) return;
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
          if (!this.lastAssistantMessageId)
            throw new RuntimeError('STREAM_PROTOCOL', 'Tool result has no assistant call');
          const toolId = toolCallRecordId(
            this.options.run.id,
            this.lastAssistantMessageId,
            event.message.toolCallId,
          );
          if (!this.recordedTools.has(toolId)) {
            const providerCallId = event.message.toolCallId;
            const call = this.final?.content.find(
              (part) => part.type === 'toolCall' && part.id === providerCallId,
            );
            const argumentsPreview =
              call?.type === 'toolCall' && JSON.stringify(call.arguments).length <= 256_000
                ? call.arguments
                : { preview: 'Arguments exceeded the public display limit' };
            const at = Date.now();
            this.commit([
              {
                type: 'tool.requested',
                runId: this.options.run.id,
                at,
                data: {
                  tool: {
                    id: toolId,
                    sessionId: this.options.session.id,
                    runId: this.options.run.id,
                    branchId: this.options.run.branchId,
                    name: event.message.toolName.slice(0, 100) || 'unknown_tool',
                    arguments: argumentsPreview,
                    status: 'failed',
                    summary: '工具请求未通过执行前校验',
                    result: event.message.content
                      .filter((part) => part.type === 'text')
                      .map((part) => part.text)
                      .join('\n')
                      .slice(0, 128_000),
                    diff: null,
                    createdAt: at,
                    updatedAt: at,
                  },
                },
              },
            ]);
            this.recordedTools.add(toolId);
          }
          this.commit([
            {
              type: 'tool.context',
              runId: this.options.run.id,
              at: Date.now(),
              data: {
                branchId: this.options.run.branchId,
                afterMessageId: this.lastAssistantMessageId,
                toolCallId: toolId,
              },
              privateData: encodeContextMessage(event.message),
            },
          ]);
          break;
        }
        if (event.message.role !== 'assistant') break;
        this.final = event.message;
        if (!this.current)
          throw new RuntimeError('STREAM_PROTOCOL', 'Final model response has no active message');
        const status =
          this.cancelled || event.message.stopReason === 'aborted'
            ? 'cancelled'
            : event.message.stopReason === 'stop' ||
                event.message.stopReason === 'length' ||
                event.message.stopReason === 'toolUse'
              ? 'complete'
              : 'failed';
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
        this.current = undefined;
        break;
      }
      default:
        break;
    }
  }

  private consumeInput(input: QueueInput, message: UserMessage): void {
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
      this.persistenceFailed = true;
      this.toolAbort.abort(error);
      this.failure = error;
      this.agent.clearAllQueues();
      this.agent.abort();
      this.options.onError(error);
      throw error;
    }
  }
}
