import type { ExecutionContent, WebFetchGatewayAccess } from '@my-pi-harness/execution';
import type {
  RunView,
  SessionSummary,
  ToolDecisionInput,
  Workspace,
} from '@my-pi-harness/protocol';
import type { ApprovalReviewer } from './approval-review.js';
import type { EventInput } from '../sessions/ports.js';
import type { WorkRuntime } from '../work/runtime.js';
import type { ExternalTools } from './external.js';
import type { RunControls } from '../capabilities/ports.js';

export type ToolEventType = 'tool.requested' | 'tool.updated';

export interface ToolRunContext {
  controls?: RunControls;
  session: SessionSummary;
  run: RunView;
  signal: AbortSignal;
  supportsImages: boolean;
  recorded: Set<string>;
  assistantMessageId(): string;
  commit(events: readonly EventInput[]): void;
  persistenceFailure(error: unknown): never;
  outcomeUnknown(message: string): void;
  stopAfterTool?(reason: string): void;
}

export interface PendingApproval {
  sessionId: string;
  decide(decision: ToolDecisionInput['decision']): void;
}

export interface ToolRuntimeOptions {
  profileDirectory: string;
  resolveWorkspace(id: string): Promise<Workspace>;
  approvalTimeoutMs?: number;
  work?: WorkRuntime;
  reviewer?: ApprovalReviewer;
  externalTools?: ExternalTools;
  skillGateway?: WebFetchGatewayAccess;
  officePythonPath?: string;
}

export interface ToolExecutionResult {
  content: ExecutionContent[];
  details: undefined;
  isError?: boolean;
}
