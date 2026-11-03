import { executeTool, executeWebFetch } from '@my-pi-harness/execution';
import type { StoredToolResult, ToolCallRecord } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';
import { executeSessionTool } from '../work/tools.js';
import { nativeTool, type NativeToolFamily } from './catalog.js';
import { dispatchMcpTool } from './mcp-dispatch.js';
import { toolResultText, type ToolCallLedger } from './ledger.js';
import type { RunToolRecord } from './toolset.js';
import type { ToolExecutionResult, ToolRunContext, ToolRuntimeOptions } from './types.js';

export type ToolFamily = NativeToolFamily | 'mcp';

export interface FamilyOutcome {
  status: Extract<ToolCallRecord['status'], 'completed' | 'failed' | 'cancelled' | 'unknown'>;
  origin: StoredToolResult['origin'];
  result: ToolExecutionResult;
  recordedText?: string;
  summary?: string;
  diff?: string;
}

/** Only declarations owned by a family can be exposed under that family's accepted source. */
export function toolFamily(selected: RunToolRecord): ToolFamily {
  if (selected.source.kind === 'mcp') return 'mcp';
  const descriptor = nativeTool(selected.definition.name);
  if (descriptor?.source.kind === selected.source.kind) return descriptor.family;
  throw new RuntimeError(
    'TOOL_NOT_AVAILABLE',
    `工具没有匹配的执行入口：${selected.definition.name}`,
  );
}

/** Explicit family dispatch keeps session controls separate from filesystem and external execution. */
export async function executeToolFamily(
  family: ToolFamily,
  context: ToolRunContext,
  selected: RunToolRecord,
  ledger: ToolCallLedger,
  options: ToolRuntimeOptions,
  signal: AbortSignal,
): Promise<FamilyOutcome> {
  const tool = ledger.tool;
  switch (family) {
    case 'agent': {
      if (!context.agents?.has(tool.name))
        throw new RuntimeError('TOOL_NOT_AVAILABLE', '子任务工具运行时不可用。');
      const content = await context.agents.execute(tool.name, tool.arguments, tool.id, signal);
      return { status: 'completed', origin: 'tool', result: { content, details: undefined } };
    }
    case 'work': {
      const work = context.run.taskId
        ? options.work?.forTask(context.session.id, context.run.taskId)
        : options.work;
      if (!work) throw new RuntimeError('TOOL_NOT_AVAILABLE', '会话工具运行时不可用。');
      const text = await executeSessionTool(
        work,
        context.session.id,
        context.run.id,
        tool.id,
        tool.name,
        tool.arguments,
        signal,
      );
      return {
        status: 'completed',
        origin: 'tool',
        summary: text,
        recordedText: text,
        result: { content: [{ type: 'text', text }], details: undefined },
      };
    }
    case 'capability': {
      if (!context.controls?.has(tool.name))
        throw new RuntimeError('TOOL_NOT_AVAILABLE', '能力控制工具运行时不可用。');
      const content = await context.controls.execute(tool.name, tool.arguments, signal);
      return {
        status: 'completed',
        origin: 'tool',
        result: { content, details: undefined },
      };
    }
    case 'mcp':
      return await dispatchMcpTool(selected, ledger, options.externalTools, signal);
    case 'web': {
      const result = await executeWebFetch(tool.arguments, {
        readOnly: context.readOnly,
        ...(options.skillGateway ? { skillGateway: options.skillGateway } : {}),
        signal,
      });
      return {
        status: 'completed',
        origin: 'tool',
        summary: result.summary,
        result: { content: result.content, details: undefined },
        ...(result.diff !== undefined ? { diff: result.diff } : {}),
      };
    }
    case 'workspace': {
      if (tool.name === 'pdf_read_pages' && !context.supportsImages)
        throw new RuntimeError('MODEL_CAPABILITY', '读取PDF页图需要支持图像的模型。');
      const id = context.session.workspaceId;
      if (id === null) throw new RuntimeError('WORKSPACE_REQUIRED', '请先选择工作区。');
      const workspace = await options.resolveWorkspace(id);
      signal.throwIfAborted();
      const result = await executeTool(tool.name, tool.arguments, {
        workspaceRoot: workspace.rootPath,
        profileDirectory: options.profileDirectory,
        readOnly: context.readOnly,
        shellAccess: context.session.approvalMode === 'full-access' ? 'full-access' : 'sandboxed',
        ...(options.officePythonPath ? { officePythonPath: options.officePythonPath } : {}),
        signal,
      });
      return {
        status: 'completed',
        origin: 'tool',
        summary: result.summary,
        result: { content: result.content, details: undefined },
        ...(result.diff !== undefined ? { diff: result.diff } : {}),
      };
    }
  }
}

/** Populate only public bounded projection fields; ledger retains the complete canonical result. */
export function applyFamilyOutcome(tool: ToolCallRecord, outcome: FamilyOutcome): void {
  tool.status = outcome.status;
  tool.result = outcome.recordedText ?? toolResultText(outcome.result.content);
  if (outcome.summary !== undefined) tool.summary = outcome.summary.slice(0, 4000);
  tool.diff = outcome.diff?.slice(0, 128_000) ?? null;
}
