import { createHash } from 'node:crypto';
import type { ToolContent } from '@my-pi-harness/tools';
import type { ToolCallRecord } from '@my-pi-harness/protocol';
import type { StoredToolResult } from '@my-pi-harness/protocol/internal';
import { encodeToolResult } from '../context/codec';
import { RuntimeError } from '../errors';
import type { EventInput } from '../sessions/ports';
import type { RunToolRecord } from './toolset';
import type { ToolPolicy } from './policy';
import type { ToolExecutionResult, ToolRunContext } from './types';

type ToolEventType = 'tool.requested' | 'tool.updated';

export interface ToolCallIdentity {
  assistantMessageId: string;
  providerCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

type LedgerContext = Pick<ToolRunContext, 'session' | 'run' | 'recorded' | 'commit'>;

/** Provider call IDs pair within one assistant message, not across every turn of a Run. */
export function toolCallRecordId(
  runId: string,
  assistantMessageId: string,
  providerCallId: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([runId, assistantMessageId, providerCallId]))
    .digest('hex');
}

/** Public results are bounded text; canonical tool content retains images and original blocks. */
export function toolResultText(content: readonly ToolContent[]): string {
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .slice(0, 128_000);
}

function terminalEvents(
  context: LedgerContext,
  call: ToolCallIdentity,
  tool: ToolCallRecord,
  result: ToolExecutionResult,
  origin: StoredToolResult['origin'],
  type: ToolEventType,
  anchorRequested = false,
): readonly EventInput[] {
  const outcome = tool.status;
  if (outcome === 'running' || outcome === 'reviewing' || outcome === 'awaiting_approval')
    throw new RuntimeError('TOOL_OUTCOME_INVALID', '工具没有终态。');
  return [
    {
      type,
      runId: context.run.id,
      at: tool.updatedAt,
      data: {
        tool: structuredClone(tool),
        ...(anchorRequested ? { afterMessageId: call.assistantMessageId } : {}),
      },
    },
    {
      type: 'tool.context',
      runId: context.run.id,
      at: tool.updatedAt,
      data: {
        branchId: context.run.branchId,
        afterMessageId: call.assistantMessageId,
        toolCallId: tool.id,
      },
      privateData: encodeToolResult({
        toolResultVersion: 1,
        providerCallId: call.providerCallId,
        toolName: call.name,
        content: result.content,
        isError: result.isError === true,
        at: tool.updatedAt,
        outcome,
        origin,
      }),
    },
    ...(tool.artifacts ?? []).map((artifact) => ({
      type: 'artifact.published',
      runId: context.run.id,
      at: tool.updatedAt,
      data: { artifact },
    })),
  ];
}

/** SDK rejection and calls never entered by Pi use the same terminal/context batch as accepted calls. */
export function recordHostToolOutcome(
  context: LedgerContext,
  call: ToolCallIdentity,
  outcome: { status: 'failed' | 'interrupted'; reason: string; content: ToolContent[] },
): boolean {
  const id = toolCallRecordId(context.run.id, call.assistantMessageId, call.providerCallId);
  if (context.recorded.has(id)) return false;
  const at = Date.now();
  const tool: ToolCallRecord = {
    id,
    sessionId: context.session.id,
    runId: context.run.id,
    branchId: context.run.branchId,
    name:
      outcome.status === 'failed'
        ? call.name.slice(0, 100) || 'unknown_tool'
        : call.name.slice(0, 100),
    arguments: JSON.stringify(call.arguments).length <= 256_000 ? call.arguments : {},
    status: outcome.status,
    binding: { kind: 'rejected', reason: outcome.reason },
    dispatch: { state: 'not_applicable' },
    summary: outcome.reason,
    result: toolResultText(outcome.content),
    diff: null,
    createdAt: at,
    updatedAt: at,
  };
  context.commit(
    terminalEvents(
      context,
      call,
      tool,
      { content: outcome.content, details: undefined, isError: true },
      'host',
      'tool.requested',
      outcome.status === 'interrupted',
    ),
  );
  context.recorded.add(id);
  return true;
}

/** Accepted intent, dispatch barriers and terminal context share one failure-frozen journal owner. */
export class ToolCallLedger {
  public readonly tool: ToolCallRecord;
  public persistenceFailed = false;
  public finished = false;

  public constructor(
    private readonly context: ToolRunContext,
    private readonly call: ToolCallIdentity,
    selected: RunToolRecord,
    policy: ToolPolicy,
  ) {
    const at = Date.now();
    const blocked = context.readOnly && policy.mutating;
    const approval =
      !blocked && policy.approvalRequired && context.session.approvalMode !== 'full-access';
    this.tool = {
      id: toolCallRecordId(context.run.id, call.assistantMessageId, call.providerCallId),
      sessionId: context.session.id,
      runId: context.run.id,
      branchId: context.run.branchId,
      name: call.name,
      arguments: structuredClone(call.arguments),
      status: approval
        ? context.session.approvalMode === 'auto'
          ? 'reviewing'
          : 'awaiting_approval'
        : 'running',
      binding: { kind: 'accepted', source: selected.source, fingerprint: selected.fingerprint },
      dispatch:
        selected.source.kind === 'mcp' ? { state: 'not_started' } : { state: 'not_applicable' },
      summary: policy.summary.slice(0, 4000),
      result: null,
      diff: null,
      createdAt: at,
      updatedAt: at,
    };
  }

  public accept(): void {
    this.update('tool.requested');
    this.context.recorded.add(this.tool.id);
  }

  public update(type: ToolEventType = 'tool.updated'): void {
    this.tool.updatedAt = Date.now();
    this.persist(() => [
      {
        type,
        runId: this.context.run.id,
        at: this.tool.updatedAt,
        data: { tool: structuredClone(this.tool) },
      },
    ]);
  }

  public finish(
    result: ToolExecutionResult,
    origin: StoredToolResult['origin'],
  ): ToolExecutionResult {
    if (this.finished) throw new RuntimeError('TOOL_OUTCOME_INVALID', '工具终态已经记录。');
    this.tool.updatedAt = Date.now();
    if (result.artifacts?.length) this.tool.artifacts = result.artifacts;
    this.persist(() =>
      terminalEvents(this.context, this.call, this.tool, result, origin, 'tool.updated'),
    );
    this.finished = true;
    return result;
  }

  private persist(events: () => readonly EventInput[]): void {
    try {
      this.context.commit(events());
    } catch (error) {
      this.persistenceFailed = true;
      this.context.persistenceFailure(error);
    }
  }
}
