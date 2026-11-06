import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolDecisionInput } from '@my-pi-harness/protocol';
import { StoredToolResultSchema, type StoredToolResult } from '@my-pi-harness/protocol/internal';
import { Type, type TSchema } from 'typebox';
import { ArrayOptions } from 'typebox/type';
import { Value } from 'typebox/value';
import { RuntimeError } from '../errors';
import { nativeTools, type ToolRegistration } from '@my-pi-harness/tools';
import { applyToolOutcome } from './outcome';
import { createToolContext, bindRunTool, type BoundToolExecutor } from './bindings';
import { ToolCallLedger } from './ledger';
import { invocationPolicy, ToolApprovals } from './policy';
import { RepeatToolReminder } from './repeat-reminder';
import type { RunToolset, RunToolDefinition, RunToolRecord } from './toolset';
import type { ToolExecutionResult, ToolRunContext, ToolRuntimeOptions } from './types';

const toolArguments = Type.Record(Type.String(), Type.Unknown());
const MAX_TOOL_ERROR_CHARACTERS = 4000;
const MAX_TOOL_RESULT_BLOCKS = ArrayOptions(StoredToolResultSchema.properties.content).maxItems;

/** Check original model JSON before Pi coercion, and executable input before any dispatch. */
function validateToolInput(definition: RunToolDefinition, input: unknown): Record<string, unknown> {
  if (!Value.Check(toolArguments, input))
    throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具参数必须是JSON对象。');
  if (!Value.Check(definition.parameters, input) || JSON.stringify(input).length > 256_000)
    throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具参数无效或超过限制。');
  return input;
}

/** Compose accepted registrations, approval ownership and canonical tool accounting. */
export class ToolRuntime {
  private readonly approvals: ToolApprovals;
  private readonly nativeBindings = new WeakMap<ToolRunContext, Map<string, BoundToolExecutor>>();
  private readonly repetitions = new WeakMap<ToolRunContext, RepeatToolReminder>();
  public constructor(private readonly options: ToolRuntimeOptions) {
    this.approvals = new ToolApprovals(options);
  }

  /** Selection advertises work tools only when their actual executor is installed. */
  public get supportsWorkTools(): boolean {
    return this.options.work !== undefined;
  }

  public get registrations(): readonly ToolRegistration[] {
    return this.options.registry?.list() ?? nativeTools();
  }

  public async finishRun(
    sessionId: string,
    runId: string,
    taskId: string | null,
    failed: boolean,
  ): Promise<void> {
    if (taskId !== null) await this.options.commands?.closeTask(sessionId, taskId);
    else if (failed) await this.options.commands?.closeRun({ sessionId, runId });
  }
  public async closeSession(sessionId: string): Promise<void> {
    await this.options.commands?.closeSession(sessionId);
  }
  public async close(): Promise<void> {
    await this.options.commands?.close();
  }

  public decide(sessionId: string, id: string, input: ToolDecisionInput): void {
    this.approvals.decide(sessionId, id, input);
  }

  public createTools(
    context: ToolRunContext,
    toolset: RunToolset,
  ): AgentTool<TSchema, undefined>[] {
    const ports = createToolContext(context, this.options);
    let bindings = this.nativeBindings.get(context);
    if (!bindings) {
      bindings = new Map();
      this.nativeBindings.set(context, bindings);
    }
    const bound = bindings;
    return toolset.definitions.map((definition): AgentTool<TSchema, undefined> => {
      const selected = toolset.require(definition.name);
      const bindingKey = JSON.stringify([selected.definition.name, selected.fingerprint]);
      return {
        ...definition,
        label: definition.name,
        replay: 'never',
        executionMode: 'sequential',
        prepareArguments: (input: unknown) => {
          const error = context.argumentsError?.(input);
          if (error)
            throw new RuntimeError(
              'TOOL_ARGUMENTS_INVALID',
              `工具 ${definition.name} 的JSON参数无法解析：${error}`.slice(
                0,
                MAX_TOOL_ERROR_CHARACTERS,
              ),
            );
          return validateToolInput(definition, input);
        },
        execute: async (providerCallId, input: unknown, signal) =>
          this.execute(
            context,
            selected,
            providerCallId,
            validateToolInput(definition, input),
            signal,
            (ledger, currentSignal) => {
              let executor = bound.get(bindingKey);
              if (!executor) {
                executor = bindRunTool(selected, ports, this.options);
                bound.set(bindingKey, executor);
              }
              return executor(ledger, currentSignal);
            },
          ),
      };
    });
  }

  private async execute(
    context: ToolRunContext,
    selected: RunToolRecord,
    providerCallId: string,
    args: Record<string, unknown>,
    sdkSignal: AbortSignal | undefined,
    executeTool: BoundToolExecutor,
  ): Promise<ToolExecutionResult> {
    const signal = sdkSignal ? AbortSignal.any([sdkSignal, context.signal]) : context.signal;
    signal.throwIfAborted();
    const policy = invocationPolicy(selected, args, this.options, context.readOnly);
    const ledger = new ToolCallLedger(
      context,
      {
        assistantMessageId: context.assistantMessageId(),
        providerCallId,
        name: selected.definition.name,
        arguments: args,
      },
      selected,
      policy,
    );
    const tool = ledger.tool;
    ledger.accept();
    let repetitions = this.repetitions.get(context);
    if (!repetitions) {
      repetitions = new RepeatToolReminder();
      this.repetitions.set(context, repetitions);
    }
    const reminder = repetitions.observe(tool.name, args);
    const finish = (
      result: ToolExecutionResult,
      origin: StoredToolResult['origin'],
    ): ToolExecutionResult => {
      const appendReminder =
        reminder !== undefined &&
        (MAX_TOOL_RESULT_BLOCKS === undefined || result.content.length < MAX_TOOL_RESULT_BLOCKS);
      const retained = appendReminder
        ? { ...result, content: [...result.content, { type: 'text' as const, text: reminder }] }
        : result;
      return ledger.finish(retained, origin);
    };
    let releaseTool = (): void => undefined;
    try {
      if (context.readOnly && policy.mutating) {
        tool.status = 'denied';
        throw new RuntimeError('TOOL_READ_ONLY', '当前运行仅允许只读操作。');
      }
      if (policy.mutating)
        this.options.commands?.assertWriteAvailable({
          sessionId: context.session.id,
          runId: context.run.id,
          taskId: context.run.taskId ?? null,
        });
      if (context.beforeTool) releaseTool = await context.beforeTool(policy.mutating, signal);
      signal.throwIfAborted();
      if (policy.approvalRequired) await this.approvals.approve(context, ledger, signal);
      const outcome = await executeTool(ledger, signal);
      applyToolOutcome(tool, outcome);
      const result = finish(outcome.result, outcome.origin);
      if (outcome.status === 'unknown') context.outcomeUnknown(tool.result ?? '结果未知。');
      return result;
    } catch (error: unknown) {
      if (ledger.persistenceFailed || ledger.finished) throw error;
      const message = error instanceof Error ? error.message : '工具执行失败。';
      if (tool.dispatch.state === 'may_have_started' && !tool.dispatch.confirmedNotWritten) {
        tool.status = 'unknown';
        tool.result = '结果未知，操作可能已生效，需要核验。';
        const result = finish(
          {
            content: [{ type: 'text', text: tool.result }],
            details: undefined,
            isError: true,
          },
          'host',
        );
        context.outcomeUnknown(tool.result);
        return result;
      }
      if (signal.aborted) tool.status = 'cancelled';
      else if (tool.status !== 'denied') tool.status = 'failed';
      tool.result = message.slice(0, MAX_TOOL_ERROR_CHARACTERS);
      return finish(
        {
          content: [{ type: 'text', text: tool.result }],
          details: undefined,
          isError: true,
        },
        selected.external ? 'host' : 'tool',
      );
    } finally {
      releaseTool();
    }
  }
}
