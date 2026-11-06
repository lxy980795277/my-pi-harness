import type { ToolRegistry } from '@my-pi-harness/tools';
import type {
  ToolContent,
  WebFetchGatewayAccess,
  AgentToolHandlers,
  CommandManager,
  ArtifactToolHandlers,
} from '@my-pi-harness/tools';
import type { Artifact, RunView, SessionSummary, Workspace } from '@my-pi-harness/protocol';
import type { ApprovalReviewer } from './approval-review.js';
import type { EventInput } from '../sessions/ports.js';
import type { WorkRuntime } from '../work/runtime.js';
import type { ExternalTools } from './external.js';
import type { RunControls } from '../capabilities/ports.js';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export interface ToolRunContext {
  controls?: RunControls;
  agents?: AgentToolHandlers;
  modelStream?: StreamFn;
  beforeTool?(this: void, mutating: boolean, signal: AbortSignal): Promise<() => void>;
  session: SessionSummary;
  run: RunView;
  /** Effective capability ceiling, independent of how allowed calls receive approval. */
  readonly readOnly: boolean;
  signal: AbortSignal;
  supportsImages: boolean;
  recorded: Set<string>;
  assistantMessageId(): string;
  /** Read parser diagnostics for the exact original arguments object of the current assistant. */
  argumentsError?(input: unknown): string | undefined;
  commit(events: readonly EventInput[]): void;
  persistenceFailure(error: unknown): never;
  outcomeUnknown(message: string): void;
}

export interface ToolRuntimeOptions {
  registry?: ToolRegistry;
  profileDirectory: string;
  resolveWorkspace(id: string): Promise<Workspace>;
  approvalTimeoutMs?: number;
  work?: WorkRuntime;
  reviewer?: ApprovalReviewer;
  externalTools?: ExternalTools;
  skillGateway?: WebFetchGatewayAccess;
  pythonPath?: string;
  commands?: CommandManager;
  artifacts?(context: ToolRunContext): ArtifactToolHandlers;
}

export interface ToolExecutionResult {
  content: ToolContent[];
  details: undefined;
  isError?: boolean;
  artifacts?: Artifact[];
}
