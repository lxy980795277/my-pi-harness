import type {
  FrozenSkill,
  RunView,
  SessionSummary,
  ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import type { ResolvedModel } from '../models/gateway.js';
import type { EventInput } from '../sessions/ports.js';
import type { RunToolDefinition, RunToolset } from '../tools/toolset.js';
import type { FrozenMcpTool } from '../tools/external.js';
import { snapshotPrivateData } from '../context/codec.js';

interface RunAcceptance {
  run: RunView;
  session: SessionSummary;
  requestId: string;
  resolved: ResolvedModel;
  systemPrompt: string;
  toolset: RunToolset;
  external: readonly FrozenMcpTool[];
  candidates: readonly FrozenMcpTool[];
  diagnostics: readonly ToolDiscoveryDiagnostic[];
  workspaceCandidates: readonly RunToolDefinition[];
  skills: readonly FrozenSkill[];
}

/** Root and child Runs freeze the same request metadata before any SDK work starts. */
export function runAcceptanceEvent(input: RunAcceptance): EventInput {
  return {
    type: 'run.accepted',
    runId: input.run.id,
    at: input.run.createdAt,
    data: { run: input.run, requestId: input.requestId },
    privateData: snapshotPrivateData({
      version: 1,
      model: input.resolved.model,
      thinkingLevel: input.session.thinkingLevel,
      systemPrompt: input.systemPrompt,
      workspaceId: input.session.workspaceId,
      approvalMode: input.session.approvalMode,
      tools: input.toolset.definitions,
      mcpBindings: input.external,
      mcpCandidates: input.candidates,
      discoveryDiagnostics: input.diagnostics,
      workspaceCandidates: input.workspaceCandidates,
      skills: input.skills,
      capabilityRevision: 1,
      toolSources: input.toolset.records.map(({ source, fingerprint, definition }) => ({
        name: definition.name,
        source,
        fingerprint,
      })),
    }),
  };
}
