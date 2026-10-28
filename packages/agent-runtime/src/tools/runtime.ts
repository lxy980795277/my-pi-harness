import { createHash, randomUUID } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  TOOL_DEFINITIONS,
  describeTool,
  executeTool,
  executeWebFetch,
  type ExecutionResult,
} from '@my-pi-harness/execution';
import type {
  SessionSummary,
  ToolCallRecord,
  ToolDecisionInput,
  StoredToolResult,
} from '@my-pi-harness/protocol';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { RuntimeError } from '../errors.js';
import { encodeToolResult } from '../context/codec.js';
import type { FrozenMcpTool, ExternalToolOutcome } from './external.js';
import { SESSION_TOOL_DEFINITIONS, executeSessionTool } from '../work/tools.js';
import { RunToolset, type RunToolSelection, type RunToolDefinition } from './toolset.js';
import type { ApprovalReviewResult } from './approval-review.js';
import type {
  PendingApproval,
  ToolEventType,
  ToolExecutionResult,
  ToolRunContext,
  ToolRuntimeOptions,
} from './types.js';

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

  /** Select once before acceptance, using this executor's actual session capabilities. */
  public selectToolset(
    session: Pick<SessionSummary, 'workspaceId'>,
    external: readonly FrozenMcpTool[] = [],
    controls: readonly RunToolDefinition[] = [],
    extraWorkspace: readonly RunToolDefinition[] = [],
  ): RunToolset {
    const selections: RunToolSelection[] = [];
    for (const definition of TOOL_DEFINITIONS.filter((tool) => tool.name === 'web_fetch'))
      selections.push({ source: { kind: 'session' }, definition });
    for (const definition of controls) selections.push({ source: { kind: 'session' }, definition });
    if (this.options.work) {
      for (const definition of SESSION_TOOL_DEFINITIONS)
        selections.push({ source: { kind: 'session' }, definition });
    }
    if (session.workspaceId !== null) {
      for (const definition of [
        ...TOOL_DEFINITIONS.filter((tool) => tool.name !== 'web_fetch'),
        ...extraWorkspace,
      ])
        selections.push({ source: { kind: 'workspace' }, definition });
    }
    if (external.length > 0 && !this.options.externalTools)
      throw new RuntimeError('MCP_UNAVAILABLE', '外部工具运行时不可用。');
    for (const tool of external) {
      selections.push({
        definition: tool.definition,
        source: {
          kind: 'mcp',
          serverId: tool.selection.serverId,
          serverRevision: tool.selection.serverRevision,
          remoteToolName: tool.selection.remoteToolName,
        },
        external: tool,
      });
    }
    return new RunToolset(selections);
  }

  public createTools(
    context: ToolRunContext,
    toolset: RunToolset,
  ): AgentTool<TSchema, undefined>[] {
    return toolset.definitions.map(
      (definition): AgentTool<TSchema, undefined> => ({
        ...definition,
        label: definition.name,
        replay: 'never',
        executionMode: 'sequential',
        execute: async (providerCallId, input: unknown, signal) => {
          if (!Value.Check(Type.Record(Type.String(), Type.Unknown()), input))
            throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具参数必须是JSON对象。');
          return this.execute(context, toolset, providerCallId, definition.name, input, signal);
        },
      }),
    );
  }

  private async execute(
    context: ToolRunContext,
    toolset: RunToolset,
    providerCallId: string,
    name: string,
    args: Record<string, unknown>,
    sdkSignal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const signal = sdkSignal ? AbortSignal.any([sdkSignal, context.signal]) : context.signal;
    signal.throwIfAborted();
    if (context.recorded.size >= 64)
      throw new RuntimeError('TOOL_LIMIT', '本次运行已达到工具调用上限。');
    const selected = toolset.require(name);
    const { definition } = selected;
    if (!Value.Check(definition.parameters, args) || JSON.stringify(args).length > 256_000)
      throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具参数无效或超过限制。');
    const external = selected.source.kind === 'mcp';
    let policy = { approvalRequired: false, mutating: false, summary: name };
    if (selected.source.kind === 'workspace' || name === 'web_fetch')
      policy = describeTool(name, args);
    if (selected.source.kind === 'mcp')
      policy = { approvalRequired: true, mutating: true, summary: selected.source.remoteToolName };
    if (
      selected.external &&
      this.options.externalTools?.isReadOnlyAuthorized?.(selected.external, args)
    )
      policy = { ...policy, approvalRequired: false, mutating: false };
    if (name === 'request_skill_tools')
      policy = { approvalRequired: true, mutating: false, summary: '授予本次运行的Skill工具权限' };
    const at = Date.now();
    let status: ToolCallRecord['status'] = 'running';
    if (policy.approvalRequired && context.session.approvalMode !== 'full-access') {
      status = 'awaiting_approval';
      if (context.session.approvalMode === 'auto') status = 'reviewing';
    }
    const tool: ToolCallRecord = {
      id: toolCallRecordId(context.run.id, context.assistantMessageId(), providerCallId),
      sessionId: context.session.id,
      runId: context.run.id,
      branchId: context.run.branchId,
      name,
      arguments: structuredClone(args),
      status,
      binding: { kind: 'accepted', source: selected.source, fingerprint: selected.fingerprint },
      dispatch: external ? { state: 'not_started' } : { state: 'not_applicable' },
      summary: policy.summary.slice(0, 4000),
      result: null,
      diff: null,
      createdAt: at,
      updatedAt: at,
    };
    let persistenceFailed = false;
    let resultOrigin: StoredToolResult['origin'] = external ? 'host' : 'tool';
    const commit = (type: ToolEventType): void => {
      tool.updatedAt = Date.now();
      try {
        context.commit([
          {
            type,
            runId: context.run.id,
            at: tool.updatedAt,
            data: { tool: structuredClone(tool) },
          },
        ]);
      } catch (error) {
        persistenceFailed = true;
        context.persistenceFailure(error);
      }
    };
    const finish = (result: ToolExecutionResult): ToolExecutionResult => {
      tool.updatedAt = Date.now();
      if (
        tool.status === 'running' ||
        tool.status === 'reviewing' ||
        tool.status === 'awaiting_approval'
      )
        throw new RuntimeError('TOOL_OUTCOME_INVALID', '工具没有终态。');
      try {
        context.commit([
          {
            type: 'tool.updated',
            runId: context.run.id,
            at: tool.updatedAt,
            data: { tool: structuredClone(tool) },
          },
          {
            type: 'tool.context',
            runId: context.run.id,
            at: tool.updatedAt,
            data: {
              branchId: context.run.branchId,
              afterMessageId: context.assistantMessageId(),
              toolCallId: tool.id,
            },
            privateData: encodeToolResult({
              toolResultVersion: 1,
              providerCallId,
              toolName: name,
              content: result.content,
              isError: result.isError === true,
              at: tool.updatedAt,
              outcome: tool.status,
              origin: resultOrigin,
            }),
          },
        ]);
      } catch (error) {
        persistenceFailed = true;
        context.persistenceFailure(error);
      }
      if (name === 'revoke_skill_tools' && tool.status === 'completed')
        context.stopAfterTool?.('本次运行的工具授权已撤销。');
      return result;
    };
    commit('tool.requested');
    context.recorded.add(tool.id);
    try {
      if (name === 'pdf_read_pages' && !context.supportsImages)
        throw new RuntimeError('MODEL_CAPABILITY', '读取PDF页图需要支持图像的模型。');
      if (
        selected.source.kind === 'session' &&
        name !== 'web_fetch' &&
        !context.controls?.has(name)
      ) {
        if (!this.options.work)
          throw new RuntimeError('TOOL_NOT_AVAILABLE', '会话工具运行时不可用。');
        const text = await executeSessionTool(
          this.options.work,
          context.session.id,
          context.run.id,
          tool.id,
          name,
          args,
          signal,
        );
        tool.status = 'completed';
        tool.result = text;
        tool.summary = text.slice(0, 4000);
        return finish({ content: [{ type: 'text', text }], details: undefined });
      }
      if (context.session.approvalMode === 'read-only' && policy.mutating) {
        tool.status = 'denied';
        throw new RuntimeError('TOOL_READ_ONLY', '当前会话为只读模式，禁止此操作。');
      }
      if (policy.approvalRequired) {
        let decision: ApprovalReviewResult['decision'] = 'ask';
        if (name === 'request_skill_tools') {
          tool.status = 'awaiting_approval';
          commit('tool.updated');
          decision = await this.waitForApproval(context.session.id, tool.id, signal);
          tool.approval = { source: 'user', decision, reason: null };
        } else if (context.session.approvalMode === 'full-access') {
          decision = 'allow';
          tool.approval = { source: 'full-access', decision, reason: null };
        } else if (context.session.approvalMode === 'auto') {
          const reviewed = this.options.reviewer
            ? await this.options.reviewer.review(
                {
                  session: context.session,
                  runId: context.run.id,
                  tool,
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
          commit('tool.updated');
          decision = await this.waitForApproval(context.session.id, tool.id, signal);
          tool.approval = { source: 'user', decision, reason: null };
        }
        if (decision === 'deny') {
          tool.status = 'denied';
          throw new RuntimeError('TOOL_DENIED', tool.approval?.reason ?? '本次工具请求未获批准。');
        }
        signal.throwIfAborted();
        tool.status = 'running';
        commit('tool.updated');
      }
      if (context.controls?.has(name)) {
        const content = await context.controls.execute(name, tool.arguments, signal);
        tool.status = 'completed';
        tool.result = content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .slice(0, 128_000);
        return finish({ content, details: undefined });
      }
      if (external) {
        const callAttemptId = randomUUID();
        const beforeDispatch = (): Promise<void> => {
          signal.throwIfAborted();
          if (tool.dispatch.state !== 'not_started')
            throw new RuntimeError('DUPLICATE_DISPATCH', '本次调用不允许重复派发。');
          tool.dispatch = { state: 'may_have_started', attemptId: callAttemptId, at: Date.now() };
          commit('tool.updated');
          return Promise.resolve();
        };
        const port = this.options.externalTools;
        if (!port || !selected.external)
          throw new RuntimeError('MCP_UNAVAILABLE', '外部工具运行时不可用。');
        const outcome: ExternalToolOutcome = await port.call({
          tool: selected.external,
          arguments: tool.arguments,
          callAttemptId,
          signal,
          beforeDispatch,
        });
        if (outcome.kind === 'unknown') {
          tool.status = 'unknown';
          tool.result = outcome.message.slice(0, 4000);
          const result = finish({
            content: [{ type: 'text', text: tool.result }],
            details: undefined,
            isError: true,
          });
          context.outcomeUnknown(tool.result);
          return result;
        }
        if (outcome.kind === 'not-dispatched') {
          if (tool.dispatch.state === 'may_have_started')
            tool.dispatch = { ...tool.dispatch, confirmedNotWritten: true };
          tool.status = outcome.cancelled ? 'cancelled' : 'failed';
          tool.result = outcome.message.slice(0, 4000);
          return finish({
            content: [{ type: 'text', text: tool.result }],
            details: undefined,
            isError: true,
          });
        }
        resultOrigin = 'server';
        tool.status = outcome.isError ? 'failed' : 'completed';
        tool.summary = outcome.summary.slice(0, 4000);
        tool.result = outcome.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .slice(0, 128_000);
        return finish({
          content: outcome.content,
          details: undefined,
          ...(outcome.isError ? { isError: true } : {}),
        });
      }
      let result: ExecutionResult;
      if (name === 'web_fetch') {
        result = await executeWebFetch(tool.arguments, {
          readOnly: context.session.approvalMode === 'read-only',
          ...(this.options.skillGateway ? { skillGateway: this.options.skillGateway } : {}),
          signal,
        });
      } else {
        const workspaceId = context.session.workspaceId;
        if (workspaceId === null) throw new RuntimeError('WORKSPACE_REQUIRED', '请先选择工作区。');
        const workspace = await this.options.resolveWorkspace(workspaceId);
        signal.throwIfAborted();
        result = await executeTool(name, tool.arguments, {
          workspaceRoot: workspace.rootPath,
          profileDirectory: this.options.profileDirectory,
          readOnly: context.session.approvalMode === 'read-only',
          shellAccess: context.session.approvalMode === 'full-access' ? 'full-access' : 'sandboxed',
          ...(this.options.officePythonPath
            ? { officePythonPath: this.options.officePythonPath }
            : {}),
          signal,
        });
      }
      tool.status = 'completed';
      tool.summary = result.summary.slice(0, 4000);
      tool.result = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .slice(0, 128_000);
      tool.diff = result.diff?.slice(0, 128_000) ?? null;
      return finish({ content: result.content, details: undefined });
    } catch (error: unknown) {
      if (persistenceFailed) throw error;
      const message = error instanceof Error ? error.message : '工具执行失败。';
      if (
        external &&
        tool.dispatch.state === 'may_have_started' &&
        !tool.dispatch.confirmedNotWritten
      ) {
        tool.status = 'unknown';
        tool.result = '结果未知，操作可能已生效，需要核验。';
        const result = finish({
          content: [{ type: 'text', text: tool.result }],
          details: undefined,
          isError: true,
        });
        context.outcomeUnknown(tool.result);
        return result;
      }
      if (signal.aborted) tool.status = 'cancelled';
      else if (tool.status !== 'denied') tool.status = 'failed';
      tool.result = message.slice(0, 4000);
      return finish({
        content: [{ type: 'text', text: tool.result }],
        details: undefined,
        isError: true,
      });
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
