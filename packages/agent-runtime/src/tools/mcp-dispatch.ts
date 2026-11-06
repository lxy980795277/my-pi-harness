import { randomUUID } from 'node:crypto';
import { RuntimeError } from '../errors';
import type { ExternalTools } from './external';
import type { ToolOutcome } from './outcome';
import type { ToolCallLedger } from './ledger';
import type { RunToolRecord } from './toolset';

/** A single external attempt must persist its dispatch barrier before any server write. */
export async function dispatchMcpTool(
  selected: RunToolRecord,
  ledger: ToolCallLedger,
  port: ExternalTools | undefined,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (!port || !selected.external)
    throw new RuntimeError('MCP_UNAVAILABLE', '外部工具运行时不可用。');
  if (
    selected.source.kind !== 'mcp' ||
    selected.source.serverId !== selected.external.selection.serverId ||
    selected.source.serverRevision !== selected.external.selection.serverRevision ||
    selected.source.remoteToolName !== selected.external.selection.remoteToolName
  )
    throw new RuntimeError('TOOL_NOT_AVAILABLE', 'MCP来源与接受的执行绑定不匹配。');
  const tool = ledger.tool;
  const callAttemptId = randomUUID();
  const outcome = await port.call({
    tool: selected.external,
    arguments: tool.arguments,
    callAttemptId,
    signal,
    beforeDispatch: () => {
      signal.throwIfAborted();
      if (tool.dispatch.state !== 'not_started')
        throw new RuntimeError('DUPLICATE_DISPATCH', '本次调用不允许重复派发。');
      tool.dispatch = { state: 'may_have_started', attemptId: callAttemptId, at: Date.now() };
      ledger.update();
      return Promise.resolve();
    },
  });
  if (outcome.kind === 'known')
    return {
      status: outcome.isError ? 'failed' : 'completed',
      origin: 'server',
      summary: outcome.summary,
      result: {
        content: outcome.content,
        details: undefined,
        ...(outcome.isError ? { isError: true } : {}),
      },
    };
  if (outcome.kind === 'not-dispatched' && tool.dispatch.state === 'may_have_started')
    tool.dispatch = { ...tool.dispatch, confirmedNotWritten: true };
  return {
    status: outcome.kind === 'unknown' ? 'unknown' : outcome.cancelled ? 'cancelled' : 'failed',
    origin: 'host',
    result: {
      content: [{ type: 'text', text: outcome.message.slice(0, 4000) }],
      details: undefined,
      isError: true,
    },
  };
}
