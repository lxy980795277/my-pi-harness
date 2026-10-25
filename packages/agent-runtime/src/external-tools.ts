import type { ExecutionContent } from '@my-pi-harness/execution';
import type { ApprovalMode, McpToolSelection, WorkState } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { FrozenMcpToolsSchema } from '@my-pi-harness/protocol';
import type { ExternalToolAuthorization } from '@my-pi-harness/protocol';
import type { RunToolDefinition } from './run-toolset.js';
import { RuntimeError } from './errors.js';
export type { ExternalToolAuthorization } from '@my-pi-harness/protocol';

/** Hydrated executable schemas retain TypeBox metadata; the shared journal schema validates JSON. */
export interface FrozenMcpTool {
  selection: McpToolSelection;
  definition: RunToolDefinition;
  authorization: ExternalToolAuthorization;
}

export type ExternalToolOutcome =
  | { kind: 'known'; isError: boolean; content: ExecutionContent[]; summary: string }
  | { kind: 'not-dispatched'; cancelled: boolean; message: string }
  | { kind: 'unknown'; message: string };

export interface ExternalToolCall {
  tool: FrozenMcpTool;
  arguments: Record<string, unknown>;
  callAttemptId: string;
  signal: AbortSignal;
  beforeDispatch(): Promise<void>;
}

/** Daemon-owned configuration/SDK bridge; runtime owns approvals and durable call facts. */
export interface ExternalTools {
  isReadOnlyAuthorized?(tool: FrozenMcpTool, args: Record<string, unknown>): boolean;
  freezeSelections(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    workMode: WorkState['mode'],
    selections: readonly McpToolSelection[],
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]>;
  validateBindings(tools: readonly FrozenMcpTool[], signal: AbortSignal): Promise<void>;
  restoreBindings(
    tools: readonly FrozenMcpTool[],
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]>;
  assertBindingsCurrent(tools: readonly FrozenMcpTool[]): void;
  call(input: ExternalToolCall): Promise<ExternalToolOutcome>;
}

/** Read the private input binding; its schema is checked again by the host before use. */
export function decodeFrozenMcpTools(encoded: string): readonly FrozenMcpTool[] {
  let input: unknown;
  try {
    input = JSON.parse(encoded);
  } catch (cause) {
    throw new RuntimeError('MCP_BINDING_INVALID', '保存的MCP选择无效。', { cause });
  }
  if (!Value.Check(FrozenMcpToolsSchema, input))
    throw new RuntimeError('MCP_BINDING_INVALID', '保存的MCP选择无效。');
  return input;
}

/** Compare selected identities independently of object property and picker ordering. */
export function mcpSelectionKey(selections: readonly McpToolSelection[]): string {
  return JSON.stringify(
    selections
      .map((item) => [
        item.serverId,
        item.serverRevision,
        item.remoteToolName,
        item.definitionFingerprint,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

/** Only inputs accepted under the same authority may enter the same Run. */
export function externalBindingKey(tools: readonly FrozenMcpTool[]): string {
  return JSON.stringify(
    tools
      .map((tool) => [
        mcpSelectionKey([tool.selection]),
        tool.authorization.ownerId,
        tool.authorization.identityEpoch,
        tool.authorization.accessEpoch,
        tool.authorization.credentialEpoch,
        tool.authorization.grantId,
        tool.authorization.workspaceId,
        tool.authorization.workspaceRoot,
        tool.authorization.scope,
        tool.authorization.startupFingerprint,
        tool.authorization.toolControlRevision,
        tool.authorization.readOnlyGrantId,
        tool.authorization.connectionId,
        tool.authorization.connectionAccessEpoch,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}
