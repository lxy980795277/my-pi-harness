import type { Message, UserMessage } from '@earendil-works/pi-ai';
import type { QueueInput, RunView, SessionSummary } from '@my-pi-harness/protocol';
import type { LiveMessageDelta } from '@my-pi-harness/protocol/internal';
import type { RunHooks } from './ports';
import type { RunCapabilities } from '../capabilities/run';
import type { FrozenInputCapabilities } from '../capabilities/inputs';
import type { ResolvedModel } from '../models/gateway';
import type { EventInput } from '../sessions/ports';
import type { ExternalTools } from '../tools/external';
import type { ToolRuntime } from '../tools/runtime';
import type { RunToolset } from '../tools/toolset';
import type { WorkRuntime } from '../work/runtime';

/** Accepted immutable input and host-owned ports shared by a root or delegated Run. */
export interface RunExecutionOptions {
  session: SessionSummary;
  run: RunView;
  resolved: ResolvedModel;
  history: Message[];
  user: UserMessage;
  systemPrompt: string;
  basePrompt: string;
  /** Application instructions without the parent's scoped capability directory. */
  instructionsPrompt?: string;
  eligibleInputIds: readonly string[];
  toolset: RunToolset;
  capabilities?: RunCapabilities;
  acceptedCapabilities?: FrozenInputCapabilities;
  commit(events: readonly EventInput[]): void;
  publishMessageDelta(delta: LiveMessageDelta): void;
  queue(): QueueInput[];
  /** Read the accepted private bindings of the exact queue revision being consumed. */
  queuedCapabilities?(inputId: string): FrozenInputCapabilities;
  onError(error: unknown): void;
  tools?: ToolRuntime;
  work?: WorkRuntime;
  externalTools?: ExternalTools;
  hooks?: RunHooks;
}

/** Lifecycle decisions stay with the Run rather than SDK or projection helpers. */
export interface RunAgentHost {
  signal: AbortSignal;
  recorded: Set<string>;
  assistantMessageId(): string;
  commit(events: readonly EventInput[]): void;
  failPersistence(error: unknown): never;
  rememberFailure(error: unknown): void;
  fail(error: unknown): void;
  outcomeUnknown(message: string): void;
  assertKnownOutcome(): void;
  isOutcomeUnknown(): boolean;
}
