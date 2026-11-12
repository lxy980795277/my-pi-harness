import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { ToolRunContext } from '../tools/types';
import type { AgentToolHandlers } from '@my-pi-harness/tools';
import type { EventInput } from '../sessions/ports';
import type { RuntimeError } from '../errors';
import type {
  MemorySearchResult,
  MemoryMessageSource,
  MemorySaveInput,
  MemoryAgentUpdateInput,
  MemoryAgentDeleteInput,
  MemoryMutationResult,
  SearchQueryResult,
  SearchSourceExcerpt,
  SearchSourceSelection,
} from '@my-pi-harness/protocol';
import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';

/** An injected SDK message carries the records committed only when the Run consumes it. */
export interface RunInjectedInput {
  readonly message: UserMessage;
  /** Plain task communication text; it is never a direct human preference declaration. */
  readonly taskQuery?: string;
  consume(): readonly EventInput[];
}

/** Actual Run identity supplied by the host, never by model tool arguments. */
export interface RunMemoryRequest {
  sessionId: string;
  workspaceId: string | null;
  /** Current consumed human input or delegated task input; never pending queue text. */
  query: string;
  taskId?: string;
  /** The child's exact host-authorized user memory references, not inherited prompt content. */
  userMemoryIds?: readonly string[];
  signal: AbortSignal;
}

/** Mutation provenance comes from the latest consumed direct root human input. */
export interface RunMemoryMutationContext {
  sessionId: string;
  branchId: string;
  runId: string;
  source?: MemoryMessageSource;
  signal: AbortSignal;
}

/** The host derives readable memory scopes and rechecks current identity for each request. */
export interface RunMemoryPort {
  saveMemory?(
    context: RunMemoryMutationContext,
    input: MemorySaveInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult>;
  learnMemory?(
    context: RunMemoryMutationContext,
    input: MemorySaveInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult>;
  updateMemory?(
    context: RunMemoryMutationContext,
    input: MemoryAgentUpdateInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult>;
  deleteMemory?(
    context: RunMemoryMutationContext,
    input: MemoryAgentDeleteInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult>;
  readSnapshot(input: RunMemoryRequest): Promise<MemoryRequestSnapshot>;
  isCurrent(input: RunMemoryRequest, fingerprint: string): boolean;
  canUse?(input: RunMemoryRequest): boolean;
  searchMemories?(
    input: RunMemoryRequest,
    query: string,
    limit: number,
  ): Promise<MemorySearchResult>;
  validateDelegation?(input: RunMemoryRequest, ids: readonly string[]): readonly string[];
}

/** Search scope comes from the actual root Run, never from tool parameters. */
export interface RunSearchContext {
  sessionId: string;
  branchId: string;
  runId: string;
  workspaceId: string | null;
  taskId?: string;
}

/** A discovered source remains scope-limited; a human quotation permits only its selected range. */
export interface RunSearchGrant {
  kind: 'search' | 'quote';
  selection: SearchSourceSelection;
}

export interface RunSearchPort {
  searchSessions(
    context: RunSearchContext,
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<SearchQueryResult>;
  readSearchSource(
    context: RunSearchContext,
    selection: SearchSourceSelection,
    grant: RunSearchGrant,
    signal: AbortSignal,
  ): Promise<SearchSourceExcerpt>;
  resolveQuote(sessionId: string, selection: SearchSourceSelection): SearchSourceExcerpt;
  validateQuotes(context: RunSearchContext, quotes: readonly SearchSourceSelection[]): void;
}

/** Optional execution hooks supply host policy, scheduling and coordinated settlement. */
export interface RunHooks {
  readonly readOnly: boolean;
  controls: AgentToolHandlers;
  beforeTool: NonNullable<ToolRunContext['beforeTool']>;
  /** Acquire one request slot; preparation and compaction happen before this lease. */
  acquireRequest(signal: AbortSignal): Promise<() => void>;
  /** Invoke the provider without acquiring a second slot. */
  stream: StreamFn;
  /** Track real stream settlement so Run shutdown awaits the provider. */
  trackRequest(completion: Promise<void>): void;
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
