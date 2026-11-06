import { ToolRegistry, type ToolRegistration } from './lib/tool-registry.js';
import {
  readFileTool,
  listFilesTool,
  searchFilesTool,
  writeFileTool,
  editFileTool,
  webFetchTool,
  askUserTool,
  updatePlanTool,
  updatePlanStepsTool,
  updateTodosTool,
  searchSessionHistoryTool,
  readToolResultTool,
  spawnAgentTool,
  getAgentStatusTool,
  waitAgentsTool,
  sendAgentMessageTool,
  stopAgentTool,
  toolSearchTool,
  loadSkillTool,
  readSkillResourceTool,
  runCommandTool,
  waitCommandTool,
  stopCommandTool,
  publishArtifactTool,
  readDocumentTool,
  viewImageTool,
  viewPdfPageTool,
} from './tools/index.js';

/** The native catalog composes complete tools without duplicating their definitions or policies. */
export const NATIVE_TOOL_REGISTRATIONS: readonly ToolRegistration[] = [
  readFileTool,
  listFilesTool,
  searchFilesTool,
  writeFileTool,
  editFileTool,
  webFetchTool,
  askUserTool,
  updatePlanTool,
  updatePlanStepsTool,
  updateTodosTool,
  searchSessionHistoryTool,
  readToolResultTool,
  spawnAgentTool,
  getAgentStatusTool,
  waitAgentsTool,
  sendAgentMessageTool,
  stopAgentTool,
  toolSearchTool,
  loadSkillTool,
  readSkillResourceTool,
  runCommandTool,
  waitCommandTool,
  stopCommandTool,
  publishArtifactTool,
  readDocumentTool,
  viewImageTool,
  viewPdfPageTool,
];
const catalog = new ToolRegistry(NATIVE_TOOL_REGISTRATIONS);

export function nativeTools(): readonly ToolRegistration[] {
  return catalog.list();
}
export function nativeTool(name: string): ToolRegistration | undefined {
  return catalog.get(name);
}
