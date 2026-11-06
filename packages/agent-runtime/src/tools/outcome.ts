import type { ToolCallRecord } from '@my-pi-harness/protocol';
import type { StoredToolResult } from '@my-pi-harness/protocol/internal';
import { toolResultText } from './ledger';
import type { ToolExecutionResult } from './types';

export interface ToolOutcome {
  status: Extract<ToolCallRecord['status'], 'completed' | 'failed' | 'cancelled' | 'unknown'>;
  origin: StoredToolResult['origin'];
  result: ToolExecutionResult;
  recordedText?: string;
  summary?: string;
  diff?: string;
}

/** Populate only public bounded projection fields; ledger retains the complete canonical result. */
export function applyToolOutcome(tool: ToolCallRecord, outcome: ToolOutcome): void {
  tool.status = outcome.status;
  tool.result = outcome.recordedText ?? toolResultText(outcome.result.content);
  if (outcome.summary !== undefined) tool.summary = outcome.summary.slice(0, 4000);
  tool.diff = outcome.diff?.slice(0, 128_000) ?? null;
}
