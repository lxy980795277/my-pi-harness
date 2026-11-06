import { ToolError } from './tool-registry';
import type { AskUserHandler } from '../tools/ask-user';
import type { UpdatePlanHandler } from '../tools/update-plan';
import type { UpdatePlanStepsHandler } from '../tools/update-plan-steps';
import type { UpdateTodosHandler } from '../tools/update-todos';
import type { SessionHistorySearchHandler } from '../tools/search-session-history';
import type { ToolResultReadHandler } from '../tools/read-tool-result';
import type { SpawnAgentHandler } from '../tools/spawn-agent';
import type { GetAgentStatusHandler } from '../tools/get-agent-status';
import type { WaitAgentsHandler } from '../tools/wait-agents';
import type { SendAgentMessageHandler } from '../tools/send-agent-message';
import type { StopAgentHandler } from '../tools/stop-agent';
import type { ToolSearchHandler } from '../tools/tool-search';
import type { LoadSkillHandler } from '../tools/load-skill';
import type { ReadSkillResourceHandler } from '../tools/read-skill-resource';
import type { RunCommandHandler } from '../tools/run-command';
import type { WaitCommandHandler } from '../tools/wait-command';
import type { StopCommandHandler } from '../tools/stop-command';
import type { PublishArtifactHandler } from '../tools/publish-artifact';

export interface WorkspaceToolContext {
  workspaceRoot: string;
  profileDirectory: string;
  pythonPath?: string;
  readOnly: boolean;
  signal: AbortSignal;
}
/** Exact daemon gateway authority; arbitrary loopback URLs remain unavailable. */
export interface WebFetchGatewayAccess {
  origin: string;
  token: string;
}
export interface ToolOwner {
  sessionId: string;
  runId: string;
  taskId: string | null;
}
export interface WorkToolHandlers {
  ask: AskUserHandler;
  proposePlan: UpdatePlanHandler;
  updatePlanSteps: UpdatePlanStepsHandler;
  updateTodos: UpdateTodosHandler;
  searchHistory: SessionHistorySearchHandler;
  readToolResult: ToolResultReadHandler;
}
export interface AgentToolHandlers {
  spawn: SpawnAgentHandler;
  status: GetAgentStatusHandler;
  wait: WaitAgentsHandler;
  send: SendAgentMessageHandler;
  stop: StopAgentHandler;
}
export interface CapabilityToolHandlers {
  search: ToolSearchHandler;
  loadSkill: LoadSkillHandler;
  readResource: ReadSkillResourceHandler;
}
export interface CommandToolHandlers {
  run: RunCommandHandler;
  wait: WaitCommandHandler;
  stop: StopCommandHandler;
}
export interface ArtifactToolHandlers {
  publish: PublishArtifactHandler;
}
/** Current Run identity and explicit tool handlers; concrete runtime and persistence objects stay with their owners. */
export interface ToolContext {
  owner: ToolOwner;
  readOnly: boolean;
  workspace(signal: AbortSignal): Promise<WorkspaceToolContext>;
  work?: WorkToolHandlers;
  agents?: AgentToolHandlers;
  capabilities?: CapabilityToolHandlers;
  commands?: CommandToolHandlers;
  artifacts?: ArtifactToolHandlers;
  skillGateway?: WebFetchGatewayAccess;
}

/** Missing handlers fail at execution even if a caller bypasses availability checks. */
export function requireWorkHandlers(context: ToolContext): WorkToolHandlers {
  if (!context.work) throw new ToolError('TOOL_NOT_AVAILABLE', '会话工具不可用。');
  return context.work;
}
export function requireAgentHandlers(context: ToolContext): AgentToolHandlers {
  if (!context.agents) throw new ToolError('TOOL_NOT_AVAILABLE', '子任务工具不可用。');
  return context.agents;
}
export function requireCapabilityHandlers(context: ToolContext): CapabilityToolHandlers {
  if (!context.capabilities) throw new ToolError('TOOL_NOT_AVAILABLE', '能力控制不可用。');
  return context.capabilities;
}
export function requireCommandHandlers(context: ToolContext): CommandToolHandlers {
  if (!context.commands) throw new ToolError('COMMAND_UNAVAILABLE', '命令服务不可用。');
  return context.commands;
}
