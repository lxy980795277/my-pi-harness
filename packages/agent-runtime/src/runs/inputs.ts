import { randomUUID } from 'node:crypto';
import type { Agent } from '@earendil-works/pi-agent-core';
import type { UserMessage } from '@earendil-works/pi-ai';
import type { AgentMessage, MessageView, QueueInput } from '@my-pi-harness/protocol';
import { userWithAttachments } from '../context/attachments.js';
import { communicationMessage } from '../context/agent-message.js';
import { encodeContextMessage } from '../context/codec.js';
import { RuntimeError } from '../errors.js';
import type { EventInput } from '../sessions/ports.js';
import { assertQueuedAuthority } from './agent.js';
import type { RunExecutionOptions } from './types.js';

interface RunInputHost {
  assertKnownOutcome(): void;
  isOutcomeUnknown(): boolean;
  fail(error: unknown): void;
  commit(events: readonly EventInput[]): void;
}

/** Own SDK input identity and atomically consume a queue or communication with its user message. */
export class RunInputDelivery {
  private readonly queued = new WeakMap<UserMessage, QueueInput>();
  private readonly communications = new WeakMap<UserMessage, AgentMessage>();
  private readonly eligible: Set<string>;

  public constructor(
    private readonly options: RunExecutionOptions,
    private readonly host: RunInputHost,
  ) {
    this.eligible = new Set(options.eligibleInputIds);
  }

  public receive(message: UserMessage): void {
    const input = this.queued.get(message);
    if (input) this.consumeInput(input, message);
    const incoming = this.communications.get(message);
    if (incoming) this.consumeAgentInput(incoming, message);
  }

  public rebuild(agent: Agent): void {
    agent.clearAllQueues();
    if (this.host.isOutcomeUnknown()) return;
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
      this.queued.set(message, input);
      if (input.mode === 'steer') agent.steer(message);
      else agent.followUp(message);
    }
    for (const input of this.options.agents?.incoming() ?? []) {
      const message = communicationMessage(input);
      this.communications.set(message, input);
      agent.steer(message);
    }
  }

  public allow(inputId: string): void {
    this.eligible.add(inputId);
  }
  public eligibleIds(): readonly string[] {
    return [...this.eligible];
  }

  private consumeInput(input: QueueInput, message: UserMessage): void {
    this.host.assertKnownOutcome();
    try {
      assertQueuedAuthority(this.options);
    } catch (cause) {
      this.host.fail(
        new RuntimeError('INPUT_AUTHORITY_REVOKED', '排队输入的授权已失效，消息已保留。', {
          cause,
        }),
      );
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
    this.host.commit([
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

  private consumeAgentInput(input: AgentMessage, message: UserMessage): void {
    const at = Date.now();
    const view: MessageView = {
      id: randomUUID(),
      sessionId: this.options.session.id,
      branchId: this.options.run.branchId,
      runId: this.options.run.id,
      role: 'user',
      agentMessageId: input.id,
      text: input.text,
      thinking: '',
      createdAt: at,
      status: 'complete',
      stopReason: null,
    };
    this.host.commit([
      ...(this.options.agents?.consume(input, view) ?? []),
      {
        type: 'message.started',
        runId: this.options.run.id,
        at,
        data: view,
        privateData: encodeContextMessage(message),
      },
    ]);
  }
}
