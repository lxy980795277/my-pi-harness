import type {
  AgentBoard,
  AgentBoardQuery,
  AgentMessage,
  AgentMessageTarget,
  AgentSettings,
  AgentSettingsInput,
  AgentTaskDetail,
  AgentTaskSummary,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import type { RuntimeStore } from '../sessions/ports.js';

/** Task facts share the session journal; configuration remains an independent SQLite fact. */
export interface SubagentStore extends RuntimeStore {
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
