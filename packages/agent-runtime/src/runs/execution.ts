import type { Agent } from '@earendil-works/pi-agent-core';
import type { RunView } from '@my-pi-harness/protocol';
import type { EventInput } from '../sessions/ports.js';
import { RuntimeError } from '../errors.js';
import { createRunAgent } from './agent.js';
import { RunInputDelivery } from './inputs.js';
import { RunMessageRecorder } from './messages.js';
import { runFailureMessage } from './failure.js';
import type { RunExecutionOptions } from './types.js';

/** One Pi execution owns cancellation, durable failure and descendant settlement. */
export class RunExecution {
  public readonly agent: Agent;
  public task: Promise<void> = Promise.resolve();
  public cancelled = false;
  public persistenceFailed = false;
  public outcome: RunView['status'] = 'running';
  private failure: unknown;
  private started = false;
  private unknownOutcome = false;
  private readonly toolAbort = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly messages: RunMessageRecorder;
  private readonly inputs: RunInputDelivery;

  public constructor(public readonly options: RunExecutionOptions) {
    this.messages = new RunMessageRecorder(options, {
      cancelled: () => this.cancelled,
      commit: (events) => this.commit(events),
      fail: (error) => this.fail(this.failure ?? error),
      responseLimit: (error): never => {
        this.failure ??= error;
        this.agent.abort();
        throw this.failure;
      },
    });
    this.inputs = new RunInputDelivery(options, {
      assertKnownOutcome: () => this.assertKnownOutcome(),
      isOutcomeUnknown: () => this.unknownOutcome,
      fail: (error) => this.fail(this.failure ?? error),
      commit: (events) => this.commit(events),
    });
    this.agent = createRunAgent(options, {
      signal: this.toolAbort.signal,
      recorded: this.messages.recordedTools,
      assistantMessageId: () => this.messages.assistantMessageId(),
      commit: (events) => this.commit(events),
      failPersistence: (error): never => this.failPersistence(error),
      rememberFailure: (error) => {
        this.failure ??= error;
      },
      fail: (error) => this.fail(error),
      outcomeUnknown: (message) => {
        this.unknownOutcome = true;
        this.failure ??= new RuntimeError('TOOL_OUTCOME_UNKNOWN', message);
        options.agents?.fault(this.failure);
        this.agent.clearAllQueues();
        this.toolAbort.abort(this.failure);
        this.agent.abort();
      },
      assertKnownOutcome: () => this.assertKnownOutcome(),
      isOutcomeUnknown: () => this.unknownOutcome,
    });
    this.unsubscribe = this.agent.subscribe((event) => {
      if (this.persistenceFailed) return;
      try {
        if (event.type === 'message_start' && event.message.role === 'user')
          this.inputs.receive(event.message);
        else this.messages.receive(event);
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
    this.agent.clearAllQueues();
    this.agent.abort();
    if (this.outcome !== 'running') {
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
    this.options.agents?.cancel(reason);
  }

  /** Tree failures stop actual SDK work without disguising failure as user cancellation. */
  public fail(error: unknown): void {
    this.failure ??= error;
    this.toolAbort.abort(error);
    this.agent.clearAllQueues();
    this.agent.abort();
  }

  public rebuildQueue(): void {
    this.inputs.rebuild(this.agent);
  }
  public allowQueue(inputId: string): void {
    this.inputs.allow(inputId);
  }
  public eligibleQueueIds(): readonly string[] {
    return this.inputs.eligibleIds();
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
      this.failure ??= error;
      this.options.onError(error);
    } finally {
      this.unsubscribe();
      this.options.work?.context.release(this.options.run.id);
      this.agent.clearAllQueues();
    }
    try {
      const successful =
        this.messages.final?.stopReason === 'stop' || this.messages.final?.stopReason === 'length';
      await this.options.agents?.finish(
        this.cancelled || this.failure !== undefined || !successful,
      );
    } catch (error) {
      this.failure ??= error;
      this.options.agents?.fault(error);
      this.options.onError(error);
    } finally {
      this.options.capabilities?.close();
    }
    if (this.persistenceFailed) return;
    this.messages.recordUnstartedCalls();
    const reason = this.messages.final?.stopReason;
    this.outcome = this.cancelled
      ? 'cancelled'
      : !this.failure && (reason === 'stop' || reason === 'length')
        ? 'completed'
        : 'failed';
    this.messages.finishCurrent(this.outcome === 'cancelled' ? 'cancelled' : 'failed');
    this.commit([
      {
        type: 'run.finished',
        runId: this.options.run.id,
        at: Date.now(),
        data: {
          status: this.outcome,
          finishedAt: Date.now(),
          error: this.outcome === 'failed' ? this.failureMessage() : null,
        },
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

  private failureMessage(): string {
    if (this.failure !== undefined)
      return runFailureMessage({ kind: 'owned', cause: this.failure });
    const owned = this.messages.final
      ? this.options.agents?.failure(this.messages.final)
      : undefined;
    return owned
      ? runFailureMessage({ kind: 'owned', cause: owned })
      : runFailureMessage({ kind: 'model', message: this.messages.final?.errorMessage });
  }

  private assertKnownOutcome(): void {
    if (this.unknownOutcome) throw this.failure;
  }

  private failPersistence(error: unknown): never {
    if (!this.persistenceFailed) {
      this.persistenceFailed = true;
      this.options.agents?.fault(error);
      this.toolAbort.abort(error);
      this.failure = error;
      this.agent.clearAllQueues();
      this.agent.abort();
      this.options.onError(error);
    }
    throw error;
  }
}
