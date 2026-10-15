import { createHash } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { TOOL_DEFINITIONS, describeTool, executeTool } from '@my-pi-harness/execution';
import type {
  RunView,
  SessionSummary,
  ToolCallRecord,
  ToolDecisionInput,
  Workspace,
} from '@my-pi-harness/protocol';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { RuntimeError } from './errors.js';
import type { EventInput } from './runtime-ports.js';

interface ToolRunContext {
  session: SessionSummary;
  run: RunView;
  signal: AbortSignal;
  recorded: Set<string>;
  assistantMessageId(): string;
  commit(events: readonly EventInput[]): void;
}
interface PendingApproval {
  sessionId: string;
  decide(decision: ToolDecisionInput['decision']): void;
}
export interface ToolRuntimeOptions {
  profileDirectory: string;
  resolveWorkspace(id: string): Promise<Workspace>;
  approvalTimeoutMs?: number;
}

/** Provider call IDs pair within one assistant message, not across every turn of a run. */
export function toolCallRecordId(
  runId: string,
  assistantMessageId: string,
  providerCallId: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([runId, assistantMessageId, providerCallId]))
    .digest('hex');
}

/** Runs are the lifetime owner; each approval authorizes exactly one frozen invocation. */
export class ToolRuntime {
  private readonly pending = new Map<string, PendingApproval>();
  public constructor(private readonly options: ToolRuntimeOptions) {}

  public decide(sessionId: string, id: string, input: ToolDecisionInput): void {
    const pending = this.pending.get(id);
    if (!pending || pending.sessionId !== sessionId)
      throw new RuntimeError('APPROVAL_CONFLICT', '该审批已结束或不属于此会话。');
    pending.decide(input.decision);
  }

  public createTools(context: ToolRunContext): AgentTool<TSchema, undefined>[] {
    if (context.session.workspaceId === null) return [];
    return TOOL_DEFINITIONS.map(
      (definition): AgentTool<TSchema, undefined> => ({
        ...definition,
        label: definition.name,
        replay: 'never',
        executionMode: 'sequential',
        execute: async (providerCallId, input: unknown, signal) => {
          if (!Value.Check(Type.Record(Type.String(), Type.Unknown()), input))
            throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具参数必须是JSON对象。');
          return this.execute(context, providerCallId, definition.name, input, signal);
        },
      }),
    );
  }

  private async execute(
    context: ToolRunContext,
    providerCallId: string,
    name: string,
    args: Record<string, unknown>,
    sdkSignal?: AbortSignal,
  ): Promise<{
    content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
    details: undefined;
    isError?: boolean;
  }> {
    const signal = sdkSignal ? AbortSignal.any([sdkSignal, context.signal]) : context.signal;
    signal.throwIfAborted();
    if (context.recorded.size >= 64)
      throw new RuntimeError('TOOL_LIMIT', '本次运行已达到工具调用上限。');
    const definition = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
    if (
      !definition ||
      !Value.Check(definition.parameters, args) ||
      JSON.stringify(args).length > 256_000
    )
      throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具参数无效或超过限制。');
    const policy = describeTool(name, args);
    const at = Date.now();
    const tool: ToolCallRecord = {
      id: toolCallRecordId(context.run.id, context.assistantMessageId(), providerCallId),
      sessionId: context.session.id,
      runId: context.run.id,
      branchId: context.run.branchId,
      name,
      arguments: structuredClone(args),
      status: policy.approvalRequired ? 'awaiting_approval' : 'running',
      summary: policy.summary.slice(0, 4000),
      result: null,
      diff: null,
      createdAt: at,
      updatedAt: at,
    };
    const commit = (type: 'tool.requested' | 'tool.updated'): void => {
      tool.updatedAt = Date.now();
      context.commit([
        { type, runId: context.run.id, at: tool.updatedAt, data: { tool: structuredClone(tool) } },
      ]);
    };
    commit('tool.requested');
    context.recorded.add(tool.id);
    try {
      if (context.session.approvalMode === 'read-only' && policy.mutating) {
        tool.status = 'denied';
        throw new RuntimeError('TOOL_READ_ONLY', '当前会话为只读模式，禁止此操作。');
      }
      if (policy.approvalRequired) {
        const decision = await this.waitForApproval(context.session.id, tool.id, signal);
        if (decision === 'deny') {
          tool.status = 'denied';
          throw new RuntimeError('TOOL_DENIED', '用户拒绝了本次工具请求。');
        }
        signal.throwIfAborted();
        tool.status = 'running';
        commit('tool.updated');
      }
      const workspaceId = context.session.workspaceId;
      if (workspaceId === null) throw new RuntimeError('WORKSPACE_REQUIRED', '请先选择工作区。');
      const workspace = await this.options.resolveWorkspace(workspaceId);
      signal.throwIfAborted();
      const result = await executeTool(name, tool.arguments, {
        workspaceRoot: workspace.rootPath,
        profileDirectory: this.options.profileDirectory,
        readOnly: context.session.approvalMode === 'read-only',
        signal,
      });
      tool.status = 'completed';
      tool.summary = result.summary.slice(0, 4000);
      tool.result = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .slice(0, 128_000);
      tool.diff = result.diff?.slice(0, 128_000) ?? null;
      commit('tool.updated');
      return { content: result.content, details: undefined };
    } catch (error: unknown) {
      if (signal.aborted) tool.status = 'cancelled';
      else if (tool.status !== 'denied') tool.status = 'failed';
      const message = error instanceof Error ? error.message : '工具执行失败。';
      tool.result = message.slice(0, 4000);
      commit('tool.updated');
      return { content: [{ type: 'text', text: tool.result }], details: undefined, isError: true };
    }
  }

  private async waitForApproval(
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
