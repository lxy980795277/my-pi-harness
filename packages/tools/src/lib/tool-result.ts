import type { ToolResult } from './tool-registry';

/** Preserve full text content while bounding its separate UI summary. */
export function textResult(text: string): ToolResult {
  return { summary: text.slice(0, 4000), content: [{ type: 'text', text }] };
}
