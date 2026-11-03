import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  StoredToolResultSchema,
  type StoredToolResult,
  type ToolDecisionInput,
} from '@my-pi-harness/protocol';
import { Type, type TSchema } from 'typebox';
import { ArrayOptions } from 'typebox/type';
import { Value } from 'typebox/value';
import { RuntimeError } from '../errors.js';
import { applyFamilyOutcome, executeToolFamily, toolFamily } from './families.js';
import { ToolCallLedger } from './ledger.js';
import { invocationPolicy, ToolApprovals } from './policy.js';
import { RepeatToolReminder } from './repeat-reminder.js';
import type { RunToolset, RunToolDefinition, RunToolRecord } from './toolset.js';
import type { ToolExecutionResult, ToolRunContext, ToolRuntimeOptions } from './types.js';

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

/** Compose frozen selection, family dispatch, approval ownership and canonical tool accounting. */
export class ToolRuntime {
  private readonly approvals: ToolApprovals;
  private readonly repetitions = new WeakMap<ToolRunContext, RepeatToolReminder>();
  public constructor(private readonly options: ToolRuntimeOptions) {
    this.approvals = new ToolApprovals(options);
  }

  /** Selection advertises work tools only when their actual executor is installed. */
  public get supportsWorkTools(): boolean {
    return this.options.work !== undefined;
  }

  public decide(sessionId: string, id: string, input: ToolDecisionInput): void {
    this.approvals.decide(sessionId, id, input);
  }

  public createTools(
    context: ToolRunContext,
    toolset: RunToolset,
  ): AgentTool<TSchema, undefined>[] {
    return toolset.definitions.map((definition): AgentTool<TSchema, undefined> => {
      const selected = toolset.require(definition.name);
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
          ),
      };
    });
  }

  private async execute(
    context: ToolRunContext,
    selected: RunToolRecord,
    providerCallId: string,
    args: Record<string, unknown>,
    sdkSignal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const signal = sdkSignal ? AbortSignal.any([sdkSignal, context.signal]) : context.signal;
    signal.throwIfAborted();
    const policy = invocationPolicy(selected, args, this.options);
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
      if (context.beforeTool) releaseTool = await context.beforeTool(policy.mutating, signal);
      signal.throwIfAborted();
      if (policy.approvalRequired) await this.approvals.approve(context, ledger, signal);
      const outcome = await executeToolFamily(
        toolFamily(selected),
        context,
        selected,
        ledger,
        this.options,
        signal,
      );
      applyFamilyOutcome(tool, outcome);
      const result = finish(outcome.result, outcome.origin);
      if (outcome.status === 'unknown') context.outcomeUnknown(tool.result ?? '结果未知。');
      return result;
    } catch (error: unknown) {
      if (ledger.persistenceFailed || ledger.finished) throw error;
      const message = error instanceof Error ? error.message : '工具执行失败。';
      if (
        selected.source.kind === 'mcp' &&
        tool.dispatch.state === 'may_have_started' &&
        !tool.dispatch.confirmedNotWritten
      ) {
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
        selected.source.kind === 'mcp' ? 'host' : 'tool',
      );
    } finally {
      releaseTool();
    }
  }
}
