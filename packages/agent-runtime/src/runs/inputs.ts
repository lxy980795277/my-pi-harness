import { randomUUID } from 'node:crypto';
import type { Agent } from '@earendil-works/pi-agent-core';
import type { UserMessage } from '@earendil-works/pi-ai';
import type { MessageView, QueueInput } from '@my-pi-harness/protocol';
import { userWithAttachments } from '../context/attachments';
import { encodeContextMessage } from '../context/codec';
import { RuntimeError } from '../errors';
import { combinedSkills } from '../capabilities/inputs';
import type { EventInput } from '../sessions/ports';
import { assertQueuedAuthority } from './agent';
import type { RunExecutionOptions } from './types';
import type { RunInjectedInput } from './ports';

interface RunInputHost {
  assertKnownOutcome(): void;
  isOutcomeUnknown(): boolean;
  fail(error: unknown): void;
  commit(events: readonly EventInput[]): void;
}

/** Own SDK input identity and atomically commit queue or injected-input records at actual consumption. */
export class RunInputDelivery {
  private readonly queued = new WeakMap<UserMessage, QueueInput>();
  private readonly injected = new WeakMap<UserMessage, RunInjectedInput>();
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
    const incoming = this.injected.get(message);
    if (incoming) this.host.commit(incoming.consume());
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
    for (const input of this.options.hooks?.incoming() ?? []) {
      this.injected.set(input.message, input);
      agent.steer(input.message);
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
    const frozen = this.options.queuedCapabilities?.(input.id);
    const skills = frozen ? combinedSkills(frozen) : [];
    try {
      assertQueuedAuthority(this.options);
      this.options.capabilities?.assertSkillAdditions(skills);
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
    this.options.capabilities?.stageSkills(skills);
  }
}
