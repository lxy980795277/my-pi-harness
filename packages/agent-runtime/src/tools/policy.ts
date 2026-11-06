import { nativeTool } from '@my-pi-harness/tools';
import type { ToolDecisionInput } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors';
import type { ApprovalReviewResult } from './approval-review';
import type { ToolCallLedger } from './ledger';
import type { RunToolRecord } from './toolset';
import type { ToolRunContext, ToolRuntimeOptions } from './types';

interface PendingApproval {
  sessionId: string;
  decide(decision: ToolDecisionInput['decision']): void;
}

export interface ToolPolicy {
  approvalRequired: boolean;
  mutating: boolean;
  summary: string;
}

/** Resolve the frozen source policy before recording intent or admitting tool work. */
export function invocationPolicy(
  selected: RunToolRecord,
  args: Record<string, unknown>,
  options: ToolRuntimeOptions,
  readOnly = false,
): ToolPolicy {
  const name = selected.definition.name;
  let policy = { approvalRequired: false, mutating: false, summary: name };
  if (selected.source.kind !== 'mcp') {
    const registration = options.registry ? options.registry.get(name) : nativeTool(name);
    if (registration?.source.kind === selected.source.kind)
      policy = registration.policy(args, readOnly);
  }
  if (selected.external)
    policy = {
      approvalRequired: true,
      mutating: true,
      summary: selected.external.selection.remoteToolName,
    };
  if (selected.external && options.externalTools?.isReadOnlyAuthorized?.(selected.external, args))
    policy = { ...policy, approvalRequired: false, mutating: false };
  return policy;
}

/** Per-invocation decisions expire or cancel with their owning Run. */
export class ToolApprovals {
  private readonly pending = new Map<string, PendingApproval>();
  public constructor(private readonly options: ToolRuntimeOptions) {}

  public decide(sessionId: string, id: string, input: ToolDecisionInput): void {
    const pending = this.pending.get(id);
    if (!pending || pending.sessionId !== sessionId)
      throw new RuntimeError('APPROVAL_CONFLICT', '该审批已结束或不属于此会话。');
    pending.decide(input.decision);
  }

  public async approve(
    context: ToolRunContext,
    ledger: ToolCallLedger,
    signal: AbortSignal,
  ): Promise<void> {
    const tool = ledger.tool;
    let decision: ApprovalReviewResult['decision'] = 'ask';
    if (context.session.approvalMode === 'full-access') {
      decision = 'allow';
      tool.approval = { source: 'full-access', decision, reason: null };
    } else if (context.session.approvalMode === 'auto') {
      const reviewed = this.options.reviewer
        ? await this.options.reviewer.review(
            {
              session: context.session,
              runId: context.run.id,
              ...(context.run.taskId ? { taskId: context.run.taskId } : {}),
              tool,
              ...(context.modelStream ? { modelStream: context.modelStream } : {}),
              commit: (events) => context.commit(events),
            },
            signal,
          )
        : { decision: 'ask' as const, reason: 'AI 复核不可用，请确认本次操作。' };
      decision = reviewed.decision;
      tool.approval = { source: 'ai', ...reviewed };
    }
    if (decision === 'ask') {
      tool.status = 'awaiting_approval';
      ledger.update();
      decision = await this.wait(context.session.id, tool.id, signal);
      tool.approval = { source: 'user', decision, reason: null };
    }
    if (decision === 'deny') {
      tool.status = 'denied';
      throw new RuntimeError('TOOL_DENIED', tool.approval?.reason ?? '本次工具请求未获批准。');
    }
    signal.throwIfAborted();
    tool.status = 'running';
    ledger.update();
  }

  private async wait(
    sessionId: string,
    id: string,
    signal: AbortSignal,
  ): Promise<ToolDecisionInput['decision']> {
    if (this.pending.has(id)) throw new RuntimeError('APPROVAL_CONFLICT', '重复的工具调用。');
    let cleanup = (): void => undefined;
    try {
      return await new Promise<ToolDecisionInput['decision']>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new RuntimeError('APPROVAL_EXPIRED', '工具审批已超时。')),
          this.options.approvalTimeoutMs ?? 300_000,
        );
        const abort = (): void => reject(new RuntimeError('TOOL_CANCELLED', '工具执行已取消。'));
        cleanup = (): void => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          this.pending.delete(id);
        };
        this.pending.set(id, {
          sessionId,
          decide: (decision) => {
            cleanup();
            resolve(decision);
          },
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    } finally {
      cleanup();
    }
  }
}
