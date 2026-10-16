import type { ExecutionContent } from '@my-pi-harness/execution';
import type {
  RunView,
  SessionSummary,
  ToolDecisionInput,
  Workspace,
} from '@my-pi-harness/protocol';
import type { ApprovalReviewer } from './approval-review.js';
import type { EventInput } from './runtime-ports.js';
import type { WorkRuntime } from './work-runtime.js';

export type ToolEventType = 'tool.requested' | 'tool.updated';

export interface ToolRunContext {
  session: SessionSummary;
  run: RunView;
  signal: AbortSignal;
  recorded: Set<string>;
  assistantMessageId(): string;
  commit(events: readonly EventInput[]): void;
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
}

export interface ToolExecutionResult {
  content: ExecutionContent[];
  details: undefined;
  isError?: boolean;
}
