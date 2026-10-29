import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type {
  AgentBoard,
  AgentBoardQuery,
  AgentMessage,
  AgentMessageTarget,
  AgentSettings,
  AgentSettingsInput,
  AgentTaskDetail,
  AgentTaskSummary,
  MessageView,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import type { AgentToolControls, ToolRunContext } from '../tools/types.js';
import type { EventInput, RuntimeStore } from '../sessions/ports.js';
import type { RuntimeError } from '../errors.js';

/** Task facts share the session journal; configuration remains an independent SQLite fact. */
export interface AgentStore extends RuntimeStore {
  getAgentSettings(): AgentSettings;
  putAgentSettings(input: AgentSettingsInput): AgentSettings;
  listAgentTasks(sessionId: string, branchId?: string): AgentTaskSummary[];
  getAgentTask(sessionId: string, taskId: string): AgentTaskSummary | undefined;
  getAgentTaskDetail(
    sessionId: string,
    taskId: string,
    cursor?: number,
    limit?: number,
  ): AgentTaskDetail;
  getTaskSnapshot(sessionId: string, taskId: string): SessionSnapshot;
  getTaskModelContext(
    sessionId: string,
    taskId: string,
    messageIds?: readonly string[],
  ): Record<string, unknown>[];
  listAgentMessages(sessionId: string, target?: AgentMessageTarget): AgentMessage[];
  findTaskBySource(sessionId: string, sourceToolCallId: string): AgentTaskSummary | undefined;
  listAgentBoard(query: AgentBoardQuery): AgentBoard;
}

/** A Run keeps its SDK lifecycle while delegating tree ownership to the task runtime. */
export interface AgentRunHooks {
  readonly readOnly: boolean;
  controls: AgentToolControls;
  beforeTool: NonNullable<ToolRunContext['beforeTool']>;
  stream: StreamFn;
  maxTurns: number;
  outputTokens(modelMaximum: number): number;
  /** Read only the host failure associated with this exact SDK terminal message. */
  failure(message: AssistantMessage): RuntimeError | undefined;
  incoming(): AgentMessage[];
  consume(message: AgentMessage, view: MessageView): readonly EventInput[];
  finish(cancel: boolean): Promise<void>;
  cancel(reason: string): void;
  fault(error: unknown): void;
}
