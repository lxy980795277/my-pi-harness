import type { ToolOutcome } from './outcome';
import type { ToolCallLedger } from './ledger';
import { dispatchMcpTool } from './mcp-dispatch';
import {
  nativeTool,
  type ToolRegistry,
  type ToolContext,
  type ToolResult,
} from '@my-pi-harness/tools';
import { RuntimeError } from '../errors';
import { createWorkToolHandlers } from '../work/tool-port';
import type { ToolRunContext, ToolRuntimeOptions } from './types';
import type { RunToolRecord } from './toolset';

/** An accepted operation owns its dispatch closure independently of public source metadata. */
export type BoundToolExecutor = (
  ledger: ToolCallLedger,
  signal: AbortSignal,
) => Promise<ToolOutcome>;

/** A binding belongs to one Run; child Runs resolve their own task, resources and permission ceiling. */
export function createToolContext(
  context: ToolRunContext,
  options: ToolRuntimeOptions,
): ToolContext {
  const workspace = async (signal: AbortSignal) => {
    if (context.session.workspaceId === null)
      throw new RuntimeError('WORKSPACE_REQUIRED', '请先选择工作区。');
    const current = await options.resolveWorkspace(context.session.workspaceId);
    signal.throwIfAborted();
    return {
      workspaceRoot: current.rootPath,
      profileDirectory: options.profileDirectory,
      readOnly: context.readOnly,
      signal,
      ...(options.pythonPath ? { pythonPath: options.pythonPath } : {}),
    };
  };
  const work = context.run.taskId
    ? options.work?.forTask(context.session.id, context.run.taskId)
    : options.work;
  const beforeTool = context.beforeTool;
  const owner = {
    sessionId: context.session.id,
    runId: context.run.id,
    taskId: context.run.taskId ?? null,
  };
  return {
    owner,
    readOnly: context.readOnly,
    workspace,
    ...(work ? { work: createWorkToolHandlers(work, context.session.id, context.run.id) } : {}),
    ...(context.agents ? { agents: context.agents } : {}),
    ...(context.memory ? { memory: context.memory } : {}),
    ...(context.search ? { search: context.search } : {}),
    ...(context.controls ? { capabilities: context.controls } : {}),
    ...(options.skillGateway ? { skillGateway: options.skillGateway } : {}),
    ...(options.artifacts ? { artifacts: options.artifacts(context) } : {}),
    ...(options.commands
      ? {
          commands: options.commands.bind({
            owner,
            workspace,
            ...(beforeTool
              ? { retainExecution: (signal: AbortSignal) => beforeTool(!context.readOnly, signal) }
              : {}),
            access: context.readOnly
              ? 'read-only'
              : context.session.approvalMode === 'full-access'
                ? 'full-access'
                : 'workspace-write',
            resources: async (signal) =>
              context.controls?.retainCommandResources?.(signal) ?? {
                readOnlyDirectories: [],
                verify: () => Promise.resolve(),
                release: () => undefined,
              },
          }),
        }
      : {}),
  };
}
/** Resolve only an exact accepted native source; MCP supplies its own transport registration. */
export function bindNativeTool(
  selected: RunToolRecord,
  ports: ToolContext,
  registry?: ToolRegistry,
): (
  args: Record<string, unknown>,
  i: { toolCallId: string; signal: AbortSignal },
) => Promise<ToolResult> {
  const registration = registry
    ? registry.get(selected.definition.name)
    : nativeTool(selected.definition.name);
  if (!registration || registration.source.kind !== selected.source.kind)
    throw new RuntimeError(
      'TOOL_NOT_AVAILABLE',
      `工具没有匹配的执行入口：${selected.definition.name}`,
    );
  return registration.bind(ports);
}

/** Transport bindings and native contributions expose the same runtime execution interface. */
export function bindRunTool(
  selected: RunToolRecord,
  ports: ToolContext,
  options: ToolRuntimeOptions,
): BoundToolExecutor {
  if (selected.external)
    return (ledger, signal) => dispatchMcpTool(selected, ledger, options.externalTools, signal);
  const execute = bindNativeTool(selected, ports, options.registry);
  return async (ledger, signal) => {
    const result = await execute(ledger.tool.arguments, { toolCallId: ledger.tool.id, signal });
    return {
      status: 'completed',
      origin: 'tool',
      summary: result.summary,
      result: {
        content: result.content,
        details: undefined,
        ...(result.artifacts ? { artifacts: result.artifacts } : {}),
      },
      ...(result.diff !== undefined ? { diff: result.diff } : {}),
    };
  };
}
