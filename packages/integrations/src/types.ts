import type { Tool, Resource, Prompt } from '@modelcontextprotocol/client';
import type { PersistentProcessLaunch, ProcessScope } from '@my-pi-harness/execution';
import type { TSchema } from 'typebox';

export interface McpSecretDescriptor {
  slotId: string;
  credentialRef: string;
  credentialEpoch: number;
  environmentName: string;
}

/** Secrets are transient launch bytes; only descriptors participate in startup fingerprints. */
export interface McpLaunchInput {
  command: string;
  args: readonly string[];
  workspaceRoot: string;
  profileDirectory: string;
  environment: Readonly<Record<string, string>>;
  secretDescriptors: readonly McpSecretDescriptor[];
  scope: ProcessScope;
}

export interface McpLaunchPreview {
  launch: PersistentProcessLaunch;
  startupFingerprint: string;
}

/** The daemon freezes this authorization independently of a browser login session. */
export interface McpConnectionBinding {
  ownerId: string;
  identityEpoch: number;
  serverId: string;
  serverRevision: number;
  accessEpoch: number;
  credentialEpoch: number;
  grantId: string;
  startupFingerprint: string;
  launch: McpLaunchInput;
}

/** Unsupported schemas remain visible but cannot be selected or executed. */
export interface McpDiscoveredTool {
  remoteToolName: string;
  description: string;
  definitionFingerprint: string;
  definition: Tool;
  parameters: TSchema | null;
  supported: boolean;
  unavailableReason: string | null;
}

export interface McpCatalog {
  tools: readonly McpDiscoveredTool[];
  resources?: readonly Resource[];
  prompts?: readonly Prompt[];
}

export type McpResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export type McpCallOutcome =
  | { kind: 'known'; isError: boolean; content: McpResultContent[]; summary: string }
  | { kind: 'not-dispatched'; cancelled: boolean; code: string; message: string }
  | { kind: 'unknown'; code: string; message: string };

export interface McpCallInput {
  tool: McpDiscoveredTool;
  arguments: Record<string, unknown>;
  callAttemptId: string;
  /** Resolves only after the caller has durably committed the may-have-started barrier. */
  beforeDispatch: () => Promise<void>;
  signal: AbortSignal;
  deadlineMs?: number;
}

export interface McpLease {
  readonly catalog: McpCatalog;
  call(input: McpCallInput): Promise<McpCallOutcome>;
  /** Releases only this lease. The last release waits for the owned process to close. */
  release(): Promise<void>;
}
