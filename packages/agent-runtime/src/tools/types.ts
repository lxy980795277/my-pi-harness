import type { ToolRegistry } from '@my-pi-harness/tools';
import type {
  ToolContent,
  WebFetchGatewayAccess,
  AgentToolHandlers,
  CommandManager,
  ArtifactToolHandlers,
  MemoryToolHandlers,
  SearchToolHandlers,
  WebToolHandlers,
} from '@my-pi-harness/tools';
import type { Artifact, RunView, SessionSummary, Workspace } from '@my-pi-harness/protocol';
import type { ApprovalReviewer } from './approval-review';
import type { EventInput } from '../sessions/ports';
import type { WorkRuntime } from '../work/runtime';
import type { ExternalTools } from './external';
import type { RunControls } from '../capabilities/ports';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export interface ToolRunContext {
  controls?: RunControls;
  agents?: AgentToolHandlers;
  memory?: MemoryToolHandlers;
  search?: SearchToolHandlers;
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
  web?: WebToolHandlers;
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
