import type { Message, UserMessage } from '@earendil-works/pi-ai';
import type {
  LiveMessageDelta,
  QueueInput,
  RunView,
  SessionSummary,
} from '@my-pi-harness/protocol';
import type { RunHooks } from './ports.js';
import type { RunCapabilities } from '../capabilities/run.js';
import type { FrozenInputCapabilities } from '../capabilities/inputs.js';
import type { ResolvedModel } from '../models/gateway.js';
import type { EventInput } from '../sessions/ports.js';
import type { ExternalTools } from '../tools/external.js';
import type { ToolRuntime } from '../tools/runtime.js';
import type { RunToolset } from '../tools/toolset.js';
import type { WorkRuntime } from '../work/runtime.js';

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
