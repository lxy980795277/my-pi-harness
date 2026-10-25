import type {
  ConnectionGrant,
  ConnectionOperationView,
  FrozenSkill,
} from '@my-pi-harness/protocol';
import type { ExternalToolOutcome } from './external-tools.js';

/** A grant is an audited Run fact, not an HTTP bearer or permission to execute arbitrary requests. */
export interface ConnectionGrantRequest {
  runId: string;
  skill: FrozenSkill;
  connectionId: string;
  operations: readonly string[];
  expiresAt: number;
}
export interface ConnectionGatewayCall {
  grant: ConnectionGrant;
  runId: string;
  parentToolCallId: string;
  operation: string;
  arguments: Record<string, unknown>;
  signal: AbortSignal;
  /** Persist the child intent/dispatch barrier before the one possible upstream request. */
  beforeDispatch(): Promise<void>;
}
export interface ConnectionGatewayPort {
  catalog(
    workspaceId: string | null,
    activeSkills: readonly FrozenSkill[],
    signal: AbortSignal,
  ): Promise<readonly ConnectionOperationView[]>;
  /** Caller obtains explicit approval before this synchronous authority snapshot is issued. */
  freezeGrant(request: ConnectionGrantRequest, signal: AbortSignal): Promise<ConnectionGrant>;
  call(input: ConnectionGatewayCall): Promise<ExternalToolOutcome>;
  revokeRun(runId: string): void;
}
