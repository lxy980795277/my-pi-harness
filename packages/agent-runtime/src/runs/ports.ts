import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { ToolRunContext } from '../tools/types';
import type { AgentToolHandlers } from '@my-pi-harness/tools';
import type { EventInput } from '../sessions/ports';
import type { RuntimeError } from '../errors';

/** An injected SDK message carries the records committed only when the Run consumes it. */
export interface RunInjectedInput {
  readonly message: UserMessage;
  consume(): readonly EventInput[];
}

/** Optional execution hooks supply host policy, scheduling and coordinated settlement. */
export interface RunHooks {
  readonly readOnly: boolean;
  controls: AgentToolHandlers;
  beforeTool: NonNullable<ToolRunContext['beforeTool']>;
  stream: StreamFn;
  outputTokens(modelMaximum: number): number;
  /** Read only the host failure associated with this exact SDK terminal message. */
  failure(message: AssistantMessage): RuntimeError | undefined;
  incoming(): readonly RunInjectedInput[];
  /** Await the extension's outstanding work and settle it before the Run ends. */
  finish(cancel: boolean): Promise<void>;
  /** Propagate a Run cancellation to work owned by the extension. */
  cancel(reason: string): void;
  /** Stop coordinated work after an execution or persistence failure. */
  fault(error: unknown): void;
}
