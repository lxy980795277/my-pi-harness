import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { MessageView } from '@my-pi-harness/protocol';
import { StoredToolIntentSchema } from '@my-pi-harness/protocol/internal';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { encodeContextMessage } from '../context/codec';
import { RuntimeError } from '../errors';
import { recordHostToolOutcome, toolCallRecordId, type ToolCallIdentity } from '../tools/ledger';
import type { EventInput } from '../sessions/ports';
import { messageUsage } from './message-usage';
import type { RunExecutionOptions } from './types';

interface RunMessageHost {
  cancelled(): boolean;
  commit(events: readonly EventInput[]): void;
  fail(error: unknown): void;
  responseLimit(error: RuntimeError): never;
}

/** Cancellation takes precedence over a provider's otherwise successful final message. */
function assistantMessageStatus(
  cancelled: boolean,
  stopReason: AssistantMessage['stopReason'],
): MessageView['status'] {
  if (cancelled || stopReason === 'aborted') return 'cancelled';
  if (stopReason === 'stop' || stopReason === 'length' || stopReason === 'toolUse')
    return 'complete';
  return 'failed';
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

/** Interrupted SDK finals may omit a body that has already reached the live snapshot. */
function terminalContent(
  message: AssistantMessage,
  current: MessageView,
  partial?: AssistantMessage,
): AssistantMessage {
  const content = [...message.content];
  const text = content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const thinking = content
    .filter((part) => part.type === 'thinking')
    .map((part) => part.thinking)
    .join('');
  if (text.length === 0 && current.text.length > 0)
    content.push({ type: 'text', text: current.text });
  if (thinking.length === 0 && current.thinking.length > 0) {
    const observed = partial?.content.filter((part) => part.type === 'thinking') ?? [];
    if (observed.map((part) => part.thinking).join('') === current.thinking)
      content.unshift(...observed);
    else content.unshift({ type: 'thinking', thinking: current.thinking });
  }
  return { ...message, content };
}

/** Record SDK message events without changing public projection or private replay content. */
export class RunMessageRecorder {
  public readonly recordedTools = new Set<string>();
  public final: AssistantMessage | undefined;
  private current: MessageView | undefined;
  private partial: AssistantMessage | undefined;
  private lastAssistantMessageId: string | undefined;
  private discardedAssistantCalls = false;
  private readonly declaredCalls = new Map<string, ToolCallIdentity>();

  public constructor(
    private readonly options: RunExecutionOptions,
    private readonly host: RunMessageHost,
  ) {}

  public assistantMessageId(): string {
    if (!this.lastAssistantMessageId)
      throw new RuntimeError('STREAM_PROTOCOL', 'Tool request has no assistant call');
    return this.lastAssistantMessageId;
  }

  public receive(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start': {
        if (event.message.role === 'assistant') {
          this.discardedAssistantCalls = false;
          this.finishCurrent(this.host.cancelled() ? 'cancelled' : 'failed');
          this.partial = event.message;
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
          this.host.commit([
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
        if (event.message.role === 'assistant') this.partial = event.message;
        if (update.type === 'text_delta' || update.type === 'thinking_delta') {
          const field = update.type === 'text_delta' ? 'text' : 'thinking';
          const next = this.current[field] + update.delta;
          if (next.length > 2_000_000) {
            this.host.responseLimit(
              new RuntimeError('RESPONSE_LIMIT', 'Model response exceeded the configured limit'),
            );
          }
          this.current[field] = next;
          this.options.publishMessageDelta({
            runId: this.options.run.id,
            messageId: this.current.id,
            [field]: update.delta,
          });
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
          recordHostToolOutcome(
            this.ledgerContext(),
            {
              assistantMessageId: this.lastAssistantMessageId,
              providerCallId: resultMessage.toolCallId,
              name: resultMessage.toolName,
              arguments: argumentsPreview,
            },
            {
              status: 'failed',
              reason: '工具请求未通过执行前校验',
              content: resultMessage.content,
            },
          );
          break;
        }
        if (event.message.role !== 'assistant') break;
        this.final = event.message;
        if (!this.current)
          throw new RuntimeError('STREAM_PROTOCOL', 'Final model response has no active message');
        let status = assistantMessageStatus(this.host.cancelled(), event.message.stopReason);
        if (status === 'complete' && !validToolIntents(event.message)) {
          status = 'failed';
          this.discardedAssistantCalls = true;
          this.host.fail(
            new RuntimeError('MODEL_TOOL_INTENT_INVALID', '模型返回的工具调用标识或参数格式无效。'),
          );
        }
        const terminal =
          status === 'complete'
            ? event.message
            : terminalContent(event.message, this.current, this.partial);
        const text = terminal.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('');
        const thinking = terminal.content
          .filter((part) => part.type === 'thinking')
          .map((part) => part.thinking)
          .join('');
        if (text.length > 2_000_000 || thinking.length > 2_000_000) {
          this.host.responseLimit(
            new RuntimeError('RESPONSE_LIMIT', 'Model response exceeded the configured limit'),
          );
        }
        const at = Date.now();
        const usage = messageUsage(terminal.usage);
        this.current = {
          ...this.current,
          text,
          thinking,
          status,
          stopReason: event.message.stopReason,
          finishedAt: at,
          ...(usage ? { usage } : {}),
        };
        this.host.commit([
          {
            type: 'message.completed',
            runId: this.options.run.id,
            at,
            data: { message: this.current },
            ...(validToolIntents(terminal) ? { privateData: encodeContextMessage(terminal) } : {}),
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
            assistantMessageId: this.current.id,
            providerCallId: call.id,
            name: call.name,
            arguments: call.arguments,
          });
        }
        this.current = undefined;
        this.partial = undefined;
        break;
      }
      default:
        break;
    }
  }

  public finishCurrent(status: 'failed' | 'cancelled'): void {
    if (!this.current) return;
    const at = Date.now();
    const stopReason = status === 'cancelled' ? 'aborted' : 'error';
    const terminal = this.partial
      ? terminalContent({ ...this.partial, stopReason }, this.current)
      : undefined;
    this.current = { ...this.current, status, stopReason, finishedAt: at };
    this.host.commit([
      {
        type: 'message.completed',
        runId: this.options.run.id,
        at,
        data: { message: this.current },
        ...(terminal && validToolIntents(terminal)
          ? { privateData: encodeContextMessage(terminal) }
          : {}),
      },
    ]);
    this.current = undefined;
    this.partial = undefined;
  }

  /** Pair declared calls that the sequential SDK never entered before termination. */
  public recordUnstartedCalls(): void {
    const text = '宿主记录：本次运行结束前未派发此调用。';
    for (const call of this.declaredCalls.values())
      recordHostToolOutcome(this.ledgerContext(), call, {
        status: 'interrupted',
        reason: text,
        content: [{ type: 'text', text }],
      });
  }

  private ledgerContext() {
    return {
      session: this.options.session,
      run: this.options.run,
      recorded: this.recordedTools,
      commit: (events: readonly EventInput[]) => this.host.commit(events),
    };
  }
}
